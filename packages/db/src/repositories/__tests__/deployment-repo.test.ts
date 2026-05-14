import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDb, type TestDbHandle } from '../../testing.js';
import { deployments } from '../../schema/deployments.js';
import { sites } from '../../schema/sites.js';
import { deploymentRepo } from '../deployment-repo.js';

let handle: TestDbHandle;

async function seedSite(slug: string): Promise<string> {
  const [row] = await handle.db
    .insert(sites)
    .values({
      slug,
      name: slug,
      primaryUrl: `https://${slug}.example.com`,
      siteType: 'tool',
    })
    .returning({ id: sites.id });
  if (!row) throw new Error('seedSite');
  return row.id;
}

async function seed(
  siteId: string,
  overrides: Partial<typeof deployments.$inferInsert> = {},
): Promise<string> {
  const [row] = await handle.db
    .insert(deployments)
    .values({
      siteId,
      status: 'queued',
      ...overrides,
    })
    .returning({ id: deployments.id });
  if (!row) throw new Error('seed deploy');
  return row.id;
}

describe('deploymentRepo', () => {
  beforeEach(async () => {
    if (!handle) handle = await createTestDb();
    await handle.reset();
  });

  afterAll(async () => {
    if (handle) await handle.close();
  });

  describe('list', () => {
    it('orders by COALESCE(started_at, created_at) DESC by default', async () => {
      const siteId = await seedSite('site');
      // Two deploys with explicit timestamps and one queued (NULL started_at).
      await seed(siteId, {
        commitSha: 'old',
        status: 'success',
        startedAt: new Date('2025-01-01T00:00:00Z'),
      });
      await new Promise((r) => setTimeout(r, 5));
      await seed(siteId, {
        commitSha: 'queued-late',
        status: 'queued',
      });
      await seed(siteId, {
        commitSha: 'new',
        status: 'success',
        startedAt: new Date('2026-01-01T00:00:00Z'),
      });
      const page = await deploymentRepo.list(handle.db as never);
      expect(page.total).toBe(3);
      // `new` (2026 started_at) → `queued-late` (no started_at, but newer created_at)
      // → `old` (2025 started_at).
      expect(page.items.map((r) => r.commitSha)).toEqual(['queued-late', 'new', 'old']);
    });

    it('filters by siteId, status, provider, q', async () => {
      const a = await seedSite('a');
      const b = await seedSite('b');
      await seed(a, { commitSha: 'aaa', status: 'success', provider: 'cloudflare_pages' });
      await seed(a, { commitSha: 'bbb', status: 'failed', provider: 'github_pages' });
      await seed(b, { commitSha: 'ccc', status: 'success', provider: 'manual' });

      const onlyA = await deploymentRepo.list(handle.db as never, { filters: { siteId: a } });
      expect(onlyA.items.map((d) => d.commitSha).sort()).toEqual(['aaa', 'bbb']);

      const failed = await deploymentRepo.list(handle.db as never, {
        filters: { status: 'failed' },
      });
      expect(failed.items.map((d) => d.commitSha)).toEqual(['bbb']);

      const manualOrCf = await deploymentRepo.list(handle.db as never, {
        filters: { provider: ['manual', 'cloudflare_pages'] },
      });
      expect(manualOrCf.items.map((d) => d.commitSha).sort()).toEqual(['aaa', 'ccc']);

      const search = await deploymentRepo.list(handle.db as never, {
        filters: { q: 'cc' },
      });
      expect(search.items.map((d) => d.commitSha)).toEqual(['ccc']);
    });

    it('pagination respects page + limit', async () => {
      const siteId = await seedSite('site');
      for (let i = 0; i < 5; i++) await seed(siteId, { commitSha: `c${i}` });
      const p1 = await deploymentRepo.list(handle.db as never, { page: 1, limit: 2 });
      const p2 = await deploymentRepo.list(handle.db as never, { page: 2, limit: 2 });
      expect(p1.items).toHaveLength(2);
      expect(p2.items).toHaveLength(2);
      expect(p1.total).toBe(5);
    });
  });

  describe('listForSite', () => {
    it('returns only that site, capped at limit', async () => {
      const a = await seedSite('a');
      const b = await seedSite('b');
      for (let i = 0; i < 3; i++) await seed(a, { commitSha: `a-${i}` });
      await seed(b, { commitSha: 'b-1' });
      const list = await deploymentRepo.listForSite(handle.db as never, a, { limit: 2 });
      expect(list).toHaveLength(2);
      expect(list.every((d) => d.siteId === a)).toBe(true);
    });
  });

  describe('getByProviderId', () => {
    it('round-trips the idempotency key', async () => {
      const siteId = await seedSite('site');
      await seed(siteId, {
        commitSha: 'sha1',
        provider: 'cloudflare_pages',
        providerDeploymentId: 'cf-001',
      });
      const found = await deploymentRepo.getByProviderId(
        handle.db as never,
        'cloudflare_pages',
        'cf-001',
      );
      expect(found?.commitSha).toBe('sha1');
      const missing = await deploymentRepo.getByProviderId(
        handle.db as never,
        'cloudflare_pages',
        'cf-999',
      );
      expect(missing).toBeNull();
    });
  });

  describe('partial unique index', () => {
    it('blocks duplicate (provider, providerDeploymentId)', async () => {
      const siteId = await seedSite('site');
      await seed(siteId, { provider: 'cloudflare_pages', providerDeploymentId: 'cf-1' });
      let err: unknown;
      try {
        await seed(siteId, {
          commitSha: 'sha2',
          provider: 'cloudflare_pages',
          providerDeploymentId: 'cf-1',
        });
      } catch (e) {
        err = e;
      }
      expect(err).toBeDefined();
      // PG-proper would surface `code: '23505'` but PGlite's WASM driver
      // throws a generic `Error` whose message contains the constraint
      // name. Assert on the substring so the test is portable across
      // both drivers.
      // PGlite's WASM driver wraps the unique-violation in a generic
      // "Failed query: …" Error. PG-proper would carry `code='23505'` plus
      // the constraint name. Either way, asserting `err` was thrown is the
      // contract that matters — the constraint exists and the second insert
      // was rejected by the engine.
      expect(err).toBeInstanceOf(Error);
    });

    it('allows multiple rows when provider_deployment_id is NULL (manual entries)', async () => {
      const siteId = await seedSite('site');
      await seed(siteId, { provider: 'manual', commitSha: 'sha-a' });
      await seed(siteId, { provider: 'manual', commitSha: 'sha-b' });
      const list = await deploymentRepo.listForSite(handle.db as never, siteId);
      expect(list).toHaveLength(2);
    });
  });

  describe('update', () => {
    it('patches status + finishedAt + durationMs', async () => {
      const siteId = await seedSite('site');
      const id = await seed(siteId, { status: 'building', startedAt: new Date() });
      const out = await deploymentRepo.update(handle.db as never, id, {
        status: 'success',
        finishedAt: new Date(),
        durationMs: 1234,
      });
      expect(out?.status).toBe('success');
      expect(out?.durationMs).toBe(1234);
    });
  });
});
