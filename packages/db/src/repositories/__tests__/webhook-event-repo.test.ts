import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDb, type TestDbHandle } from '../../testing.js';
import { sites } from '../../schema/sites.js';
import { webhookEvents, type NewWebhookEvent } from '../../schema/webhook-events.js';
import { webhookEventRepo } from '../webhook-event-repo.js';

let handle: TestDbHandle;

async function seedSite(slug = 'fixture-site'): Promise<string> {
  const [row] = await handle.db
    .insert(sites)
    .values({
      slug,
      name: 'Fixture',
      primaryUrl: `https://${slug}.example.com`,
      siteType: 'content',
      status: 'active',
    })
    .returning({ id: sites.id });
  if (!row) throw new Error('seedSite');
  return row.id;
}

async function seedEvent(input: Partial<NewWebhookEvent> = {}): Promise<string> {
  const [row] = await handle.db
    .insert(webhookEvents)
    .values({
      provider: input.provider ?? 'github',
      eventType: input.eventType ?? 'workflow_run',
      deliveryId: input.deliveryId ?? `dlv-${Math.random().toString(16).slice(2)}`,
      signatureOk: input.signatureOk ?? true,
      payload: input.payload ?? { hello: 'world' },
      ...(input.siteId !== undefined ? { siteId: input.siteId } : {}),
      ...(input.processedAt !== undefined ? { processedAt: input.processedAt } : {}),
      ...(input.error !== undefined ? { error: input.error } : {}),
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    })
    .returning({ id: webhookEvents.id });
  if (!row) throw new Error('seedEvent');
  return row.id;
}

describe('webhookEventRepo', () => {
  beforeEach(async () => {
    if (!handle) handle = await createTestDb();
    await handle.reset();
  });

  afterAll(async () => {
    if (handle) await handle.close();
  });

  describe('create + findByDelivery', () => {
    it('round-trips a row and looks it up by (provider, delivery_id)', async () => {
      const row = await webhookEventRepo.create(handle.db as never, {
        provider: 'github',
        eventType: 'workflow_run',
        deliveryId: 'dlv-1',
        signatureOk: true,
        payload: { run: 1 },
      });
      expect(row).not.toBeNull();
      expect(row?.attempts).toBe(1);
      expect(row?.processedAt).toBeNull();

      const found = await webhookEventRepo.findByDelivery(handle.db as never, 'github', 'dlv-1');
      expect(found?.id).toBe(row?.id);
    });

    it('returns null on (provider, delivery_id) unique violation instead of throwing', async () => {
      const first = await webhookEventRepo.create(handle.db as never, {
        provider: 'cloudflare',
        eventType: 'deployment.success',
        deliveryId: 'cf-1',
        signatureOk: true,
        payload: { x: 1 },
      });
      expect(first).not.toBeNull();

      const dupe = await webhookEventRepo.create(handle.db as never, {
        provider: 'cloudflare',
        eventType: 'deployment.success',
        deliveryId: 'cf-1',
        signatureOk: true,
        payload: { x: 2 },
      });
      expect(dupe).toBeNull();

      // Same delivery_id under a *different* provider must NOT clash.
      const otherProvider = await webhookEventRepo.create(handle.db as never, {
        provider: 'github',
        eventType: 'workflow_run',
        deliveryId: 'cf-1',
        signatureOk: true,
        payload: { x: 3 },
      });
      expect(otherProvider).not.toBeNull();
    });
  });

  describe('markProcessed / markFailed', () => {
    it('markProcessed flips processed_at, clears error, optionally stamps site_id', async () => {
      const siteId = await seedSite();
      const id = await seedEvent({ error: 'old', processedAt: null });

      const updated = await webhookEventRepo.markProcessed(handle.db as never, id, {
        siteId,
      });
      expect(updated?.processedAt).not.toBeNull();
      expect(updated?.error).toBeNull();
      expect(updated?.siteId).toBe(siteId);
    });

    it('markFailed sets error and increments attempts', async () => {
      const id = await seedEvent();

      const once = await webhookEventRepo.markFailed(handle.db as never, id, 'downstream boom');
      expect(once?.error).toBe('downstream boom');
      expect(once?.attempts).toBe(2);

      const twice = await webhookEventRepo.markFailed(handle.db as never, id, 'still bad');
      expect(twice?.error).toBe('still bad');
      expect(twice?.attempts).toBe(3);
    });

    it('mark helpers return null for an unknown id (no throw)', async () => {
      const out = await webhookEventRepo.markProcessed(
        handle.db as never,
        '00000000-0000-4000-8000-000000000000',
      );
      expect(out).toBeNull();
    });
  });

  describe('list filters', () => {
    it('filters by provider / signatureOk / state with correct totals', async () => {
      await seedEvent({ provider: 'github', signatureOk: true, processedAt: new Date() });
      await seedEvent({ provider: 'github', signatureOk: true, error: 'kaboom' });
      await seedEvent({ provider: 'github', signatureOk: false });
      await seedEvent({ provider: 'cloudflare', signatureOk: true, processedAt: new Date() });

      const githubAll = await webhookEventRepo.list(handle.db as never, {
        filters: { provider: 'github' },
      });
      expect(githubAll.total).toBe(3);

      const githubBadSig = await webhookEventRepo.list(handle.db as never, {
        filters: { provider: 'github', signatureOk: false },
      });
      expect(githubBadSig.total).toBe(1);
      expect(githubBadSig.items[0]?.signatureOk).toBe(false);

      const githubFailed = await webhookEventRepo.list(handle.db as never, {
        filters: { provider: 'github', state: 'failed' },
      });
      expect(githubFailed.total).toBe(1);
      expect(githubFailed.items[0]?.error).toBe('kaboom');

      const cloudflareProcessed = await webhookEventRepo.list(handle.db as never, {
        filters: { provider: 'cloudflare', state: 'processed' },
      });
      expect(cloudflareProcessed.total).toBe(1);
    });

    it('paginates and orders by created_at DESC', async () => {
      const now = Date.now();
      await seedEvent({ deliveryId: 'a', createdAt: new Date(now - 3_000) });
      await seedEvent({ deliveryId: 'b', createdAt: new Date(now - 2_000) });
      await seedEvent({ deliveryId: 'c', createdAt: new Date(now - 1_000) });

      const page1 = await webhookEventRepo.list(handle.db as never, { page: 1, limit: 2 });
      expect(page1.items.map((r) => r.deliveryId)).toEqual(['c', 'b']);
      expect(page1.total).toBe(3);
    });
  });

  describe('pruneProcessedOlderThan', () => {
    it('removes processed rows past the cutoff and preserves signature-failed rows forever', async () => {
      const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const fresh = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);

      // (a) old + processed → DELETE
      const aId = await seedEvent({
        deliveryId: 'a',
        signatureOk: true,
        processedAt: old,
        createdAt: old,
      });
      // (b) old + signature_ok=false → KEEP (audit)
      const bId = await seedEvent({
        deliveryId: 'b',
        signatureOk: false,
        createdAt: old,
      });
      // (c) fresh + processed → KEEP (below cutoff)
      const cId = await seedEvent({
        deliveryId: 'c',
        signatureOk: true,
        processedAt: fresh,
        createdAt: fresh,
      });
      // (d) old + unprocessed (error) → KEEP (admin needs to replay)
      const dId = await seedEvent({
        deliveryId: 'd',
        signatureOk: true,
        error: 'boom',
        createdAt: old,
      });

      const deleted = await webhookEventRepo.pruneProcessedOlderThan(handle.db as never, 14);
      expect(deleted).toBe(1);

      const remaining = await webhookEventRepo.list(handle.db as never);
      const ids = remaining.items.map((r) => r.id).sort();
      expect(ids).toEqual([bId, cId, dId].sort());
      expect(ids).not.toContain(aId);
    });

    it('returns 0 for non-positive days without touching the table', async () => {
      await seedEvent();
      const out = await webhookEventRepo.pruneProcessedOlderThan(handle.db as never, 0);
      expect(out).toBe(0);
    });
  });
});
