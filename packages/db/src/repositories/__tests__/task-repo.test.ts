import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDb, type TestDbHandle } from '../../testing.js';
import { sites } from '../../schema/sites.js';
import { tasks, type NewTask, type Task } from '../../schema/tasks.js';
import { taskRepo } from '../task-repo.js';

let handle: TestDbHandle;

async function seedSite(slug: string): Promise<string> {
  const [row] = await handle.db
    .insert(sites)
    .values({ slug, name: slug, primaryUrl: `https://${slug}.example.com`, siteType: 'tool' })
    .returning({ id: sites.id });
  if (!row) throw new Error('seedSite');
  return row.id;
}

async function seedTask(overrides: Partial<NewTask> = {}): Promise<Task> {
  const [row] = await handle.db
    .insert(tasks)
    .values({ kind: 'content.draft', ...overrides })
    .returning();
  if (!row) throw new Error('seedTask');
  return row;
}

describe('taskRepo', () => {
  beforeEach(async () => {
    if (!handle) handle = await createTestDb();
    await handle.reset();
  });

  afterAll(async () => {
    if (handle) await handle.close();
  });

  describe('create + getById', () => {
    it('inserts with sensible defaults', async () => {
      const t = await taskRepo.create(handle.db as never, { kind: 'content.draft' });
      expect(t.status).toBe('queued');
      expect(t.attempts).toBe(0);
      expect(t.maxAttempts).toBe(3);
      expect(t.priority).toBe(0);
      expect(t.payload).toEqual({});
      expect(t.availableAt).toBeInstanceOf(Date);

      const fetched = await taskRepo.getById(handle.db as never, t.id);
      expect(fetched?.id).toBe(t.id);

      expect(
        await taskRepo.getById(handle.db as never, '00000000-0000-0000-0000-000000000000'),
      ).toBeNull();
    });

    it('binds optional siteId via FK', async () => {
      const siteId = await seedSite('site');
      const t = await taskRepo.create(handle.db as never, {
        kind: 'audit.run',
        siteId,
      });
      expect(t.siteId).toBe(siteId);
    });
  });

  describe('list filters', () => {
    it('filters by kind / status / siteId / q', async () => {
      const siteA = await seedSite('a');
      const siteB = await seedSite('b');
      await seedTask({ kind: 'content.draft', siteId: siteA });
      await seedTask({ kind: 'audit.run', siteId: siteA, status: 'failed', lastError: 'boom' });
      await seedTask({ kind: 'audit.run', siteId: siteB });

      const drafts = await taskRepo.list(handle.db as never, {
        filters: { kind: 'content.draft' },
      });
      expect(drafts.items).toHaveLength(1);
      expect(drafts.items[0]?.kind).toBe('content.draft');

      const onA = await taskRepo.list(handle.db as never, { filters: { siteId: siteA } });
      expect(onA.items).toHaveLength(2);

      const failed = await taskRepo.list(handle.db as never, { filters: { status: 'failed' } });
      expect(failed.items).toHaveLength(1);

      const search = await taskRepo.list(handle.db as never, { filters: { q: 'boom' } });
      expect(search.items.map((r) => r.kind)).toEqual(['audit.run']);
    });

    it('honors page + limit', async () => {
      for (let i = 0; i < 5; i++) await seedTask({ kind: 'content.draft' });
      const p1 = await taskRepo.list(handle.db as never, { page: 1, limit: 2 });
      const p2 = await taskRepo.list(handle.db as never, { page: 2, limit: 2 });
      expect(p1.items).toHaveLength(2);
      expect(p2.items).toHaveLength(2);
      expect(p1.total).toBe(5);
    });
  });

  describe('findActiveByDedupeKey', () => {
    it('finds an in-flight row but skips terminal ones (slot released)', async () => {
      // Same dedupe_key may legitimately appear once an old row terminates.
      await seedTask({ kind: 'audit.run', dedupeKey: 'dk-1', status: 'succeeded' });
      const live = await seedTask({ kind: 'audit.run', dedupeKey: 'dk-1', status: 'queued' });

      const found = await taskRepo.findActiveByDedupeKey(handle.db as never, 'dk-1');
      expect(found?.id).toBe(live.id);

      expect(await taskRepo.findActiveByDedupeKey(handle.db as never, 'nope')).toBeNull();
      expect(await taskRepo.findActiveByDedupeKey(handle.db as never, '')).toBeNull();
    });

    it('partial unique index: cannot have two queued rows with the same dedupe_key', async () => {
      await seedTask({ kind: 'audit.run', dedupeKey: 'dk-2' });
      let err: unknown;
      try {
        await seedTask({ kind: 'audit.run', dedupeKey: 'dk-2' });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(Error);
    });
  });

  describe('claimNext', () => {
    it('returns null on an empty queue', async () => {
      const got = await taskRepo.claimNext(handle.db as never, { leaseSeconds: 60 });
      expect(got).toBeNull();
    });

    it('claims the highest priority eligible row, stamps token + lease + attempts', async () => {
      const lo = await seedTask({ kind: 'content.draft', priority: 0 });
      const hi = await seedTask({ kind: 'content.draft', priority: 50 });
      // A future-availabilty row should be ignored.
      const future = new Date(Date.now() + 60_000);
      await seedTask({ kind: 'content.draft', priority: 99, availableAt: future });

      const claim = await taskRepo.claimNext(handle.db as never, { leaseSeconds: 30 });
      expect(claim?.id).toBe(hi.id);
      expect(claim?.status).toBe('claimed');
      expect(claim?.claimToken).toBeTypeOf('string');
      expect(claim?.attempts).toBe(1);
      expect(claim?.claimLeaseUntil).toBeInstanceOf(Date);
      expect(claim!.claimLeaseUntil!.getTime()).toBeGreaterThan(Date.now());

      const next = await taskRepo.claimNext(handle.db as never, { leaseSeconds: 30 });
      expect(next?.id).toBe(lo.id);

      const empty = await taskRepo.claimNext(handle.db as never, { leaseSeconds: 30 });
      expect(empty).toBeNull();
    });

    it('respects the kinds filter', async () => {
      await seedTask({ kind: 'content.draft' });
      const want = await seedTask({ kind: 'audit.run' });

      const claim = await taskRepo.claimNext(handle.db as never, {
        leaseSeconds: 30,
        kinds: ['audit.run'],
      });
      expect(claim?.id).toBe(want.id);

      // The remaining queued row is not 'audit.run' → null.
      const second = await taskRepo.claimNext(handle.db as never, {
        leaseSeconds: 30,
        kinds: ['audit.run'],
      });
      expect(second).toBeNull();
    });

    it('5 parallel claims over 5 queued rows hand out distinct rows (SKIP LOCKED semantics)', async () => {
      const ids = new Set<string>();
      for (let i = 0; i < 5; i++) {
        const t = await seedTask({ kind: 'content.draft' });
        ids.add(t.id);
      }
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          taskRepo.claimNext(handle.db as never, { leaseSeconds: 30 }),
        ),
      );
      const claimedIds = results.map((r) => r?.id).filter((v): v is string => !!v);
      expect(new Set(claimedIds).size).toBe(claimedIds.length);
      expect(claimedIds.every((id) => ids.has(id))).toBe(true);
      expect(claimedIds.length).toBe(5);
    });

    it('records claimedBy when supplied', async () => {
      await seedTask({ kind: 'content.draft' });
      const owner = '11111111-1111-4111-8111-111111111111';
      const claim = await taskRepo.claimNext(handle.db as never, {
        leaseSeconds: 30,
        claimedBy: owner,
      });
      expect(claim?.claimedBy).toBe(owner);
    });
  });

  describe('extendLease / complete / failTerminal', () => {
    it('round-trip: claim → heartbeat → complete', async () => {
      await seedTask({ kind: 'content.draft' });
      const claim = await taskRepo.claimNext(handle.db as never, { leaseSeconds: 10 });
      expect(claim).not.toBeNull();
      const token = claim!.claimToken!;

      const t1 = claim!.claimLeaseUntil!.getTime();
      await new Promise((r) => setTimeout(r, 5));
      const beat = await taskRepo.extendLease(handle.db as never, claim!.id, token, 60);
      expect(beat?.claimLeaseUntil?.getTime()).toBeGreaterThan(t1);

      const done = await taskRepo.complete(handle.db as never, claim!.id, token, { ok: true });
      expect(done?.status).toBe('succeeded');
      expect(done?.result).toEqual({ ok: true });
      expect(done?.claimToken).toBeNull();
      expect(done?.finishedAt).toBeInstanceOf(Date);
    });

    it('extendLease returns null when claim_token does not match', async () => {
      await seedTask({ kind: 'content.draft' });
      const claim = await taskRepo.claimNext(handle.db as never, { leaseSeconds: 10 });
      const stale = await taskRepo.extendLease(
        handle.db as never,
        claim!.id,
        '00000000-0000-0000-0000-000000000000',
        60,
      );
      expect(stale).toBeNull();
    });

    it('complete is rejected (null) when status is no longer claimed', async () => {
      await seedTask({ kind: 'content.draft' });
      const claim = await taskRepo.claimNext(handle.db as never, { leaseSeconds: 10 });
      // Pretend an external reset happened.
      await taskRepo.update(handle.db as never, claim!.id, {
        status: 'failed',
        claimToken: null,
      });
      const out = await taskRepo.complete(
        handle.db as never,
        claim!.id,
        claim!.claimToken!,
        undefined,
      );
      expect(out).toBeNull();
    });

    it('failTerminal stamps last_error + clears claim_token', async () => {
      await seedTask({ kind: 'content.draft' });
      const claim = await taskRepo.claimNext(handle.db as never, { leaseSeconds: 10 });
      const out = await taskRepo.failTerminal(
        handle.db as never,
        claim!.id,
        claim!.claimToken!,
        'kaboom',
      );
      expect(out?.status).toBe('failed');
      expect(out?.lastError).toBe('kaboom');
      expect(out?.claimToken).toBeNull();
    });

    it('requeueAfterFailure returns the row to queued with delayed availability', async () => {
      await seedTask({ kind: 'content.draft' });
      const claim = await taskRepo.claimNext(handle.db as never, { leaseSeconds: 10 });
      const next = new Date(Date.now() + 30_000);
      const out = await taskRepo.requeueAfterFailure(
        handle.db as never,
        claim!.id,
        claim!.claimToken!,
        'transient',
        next,
      );
      expect(out?.status).toBe('queued');
      expect(out?.lastError).toBe('transient');
      expect(out?.claimToken).toBeNull();
      expect(out?.availableAt.getTime()).toBeGreaterThanOrEqual(next.getTime() - 5);
    });
  });

  describe('sweepExpiredLeases', () => {
    it('requeues claimed rows whose lease expired (attempts < max)', async () => {
      await seedTask({ kind: 'content.draft', maxAttempts: 3 });
      const claim = await taskRepo.claimNext(handle.db as never, { leaseSeconds: 1 });
      // Force the lease to be in the past.
      await taskRepo.update(handle.db as never, claim!.id, {
        claimLeaseUntil: new Date(Date.now() - 1_000),
      });

      const swept = await taskRepo.sweepExpiredLeases(handle.db as never);
      expect(swept).toEqual({ requeued: 1, expired: 0 });

      const fresh = await taskRepo.getById(handle.db as never, claim!.id);
      expect(fresh?.status).toBe('queued');
      expect(fresh?.claimToken).toBeNull();
      // available_at pushed into the future by backoff.
      expect(fresh!.availableAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('expires (terminal) when attempts have already reached max_attempts', async () => {
      // Seed a row whose lease is past-due AND whose attempts are exhausted.
      const t = await seedTask({
        kind: 'content.draft',
        maxAttempts: 2,
        attempts: 2,
        status: 'claimed',
        claimToken: '11111111-1111-4111-8111-111111111111',
        claimLeaseUntil: new Date(Date.now() - 1_000),
      });

      const swept = await taskRepo.sweepExpiredLeases(handle.db as never);
      expect(swept).toEqual({ requeued: 0, expired: 1 });

      const fresh = await taskRepo.getById(handle.db as never, t.id);
      expect(fresh?.status).toBe('expired');
      expect(fresh?.lastError).toBe('lease expired');
      expect(fresh?.claimToken).toBeNull();
    });

    it('leaves healthy claims (lease in the future) untouched', async () => {
      await seedTask({ kind: 'content.draft' });
      const claim = await taskRepo.claimNext(handle.db as never, { leaseSeconds: 60 });
      const swept = await taskRepo.sweepExpiredLeases(handle.db as never);
      expect(swept).toEqual({ requeued: 0, expired: 0 });
      const fresh = await taskRepo.getById(handle.db as never, claim!.id);
      expect(fresh?.status).toBe('claimed');
    });
  });
});
