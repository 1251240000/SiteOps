import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { tasks as tasksTable, taskRepo } from '@siteops/db';
import { createTestDb, type TestDbHandle } from '@siteops/db/testing';
import { AppError } from '@siteops/shared';

import { taskService } from '../task-service.js';

let handle: TestDbHandle;
const deps = () => ({ db: handle.db as never });

describe('taskService', () => {
  beforeEach(async () => {
    if (!handle) handle = await createTestDb();
    await handle.reset();
  });

  afterAll(async () => {
    if (handle) await handle.close();
  });

  describe('enqueue', () => {
    it('inserts a brand-new row when no dedupeKey is supplied', async () => {
      const out = await taskService.enqueue(deps(), {
        kind: 'content.draft',
        priority: 0,
        payload: {},
        maxAttempts: 3,
      });
      expect(out.created).toBe(true);
      expect(out.task.kind).toBe('content.draft');
      expect(out.task.status).toBe('queued');
    });

    it('is idempotent across re-enqueues with the same dedupeKey', async () => {
      const a = await taskService.enqueue(deps(), {
        kind: 'audit.run',
        priority: 0,
        payload: { siteId: 'x' },
        maxAttempts: 3,
        dedupeKey: 'audit:x:2026-05-17',
      });
      const b = await taskService.enqueue(deps(), {
        kind: 'audit.run',
        priority: 0,
        payload: { siteId: 'x' },
        maxAttempts: 3,
        dedupeKey: 'audit:x:2026-05-17',
      });
      expect(a.created).toBe(true);
      expect(b.created).toBe(false);
      expect(b.task.id).toBe(a.task.id);
    });

    it('releases the dedupe slot once the previous instance terminates', async () => {
      const a = await taskService.enqueue(deps(), {
        kind: 'audit.run',
        priority: 0,
        payload: {},
        maxAttempts: 3,
        dedupeKey: 'audit:y',
      });
      // Force-terminate the old row.
      await taskRepo.update(handle.db as never, a.task.id, {
        status: 'succeeded',
        finishedAt: new Date(),
      });
      const b = await taskService.enqueue(deps(), {
        kind: 'audit.run',
        priority: 0,
        payload: {},
        maxAttempts: 3,
        dedupeKey: 'audit:y',
      });
      expect(b.created).toBe(true);
      expect(b.task.id).not.toBe(a.task.id);
    });
  });

  describe('claimNext', () => {
    it('returns idle:true when the queue is empty', async () => {
      const out = await taskService.claimNext(deps(), { leaseSeconds: 30 });
      expect(out).toEqual({ idle: true });
    });

    it('claims and returns idle:false', async () => {
      await taskService.enqueue(deps(), {
        kind: 'content.draft',
        priority: 0,
        payload: {},
        maxAttempts: 3,
      });
      const out = await taskService.claimNext(deps(), { leaseSeconds: 30 });
      if (out.idle) throw new Error('expected non-idle claim');
      expect(out.task.status).toBe('claimed');
      expect(out.task.claimToken).toBeTypeOf('string');
    });
  });

  describe('heartbeat', () => {
    it('extends the lease when the claimToken matches', async () => {
      await taskService.enqueue(deps(), {
        kind: 'content.draft',
        priority: 0,
        payload: {},
        maxAttempts: 3,
      });
      const claim = await taskService.claimNext(deps(), { leaseSeconds: 5 });
      if (claim.idle) throw new Error('expected claim');
      const t1 = claim.task.claimLeaseUntil!.getTime();
      await new Promise((r) => setTimeout(r, 5));
      const beat = await taskService.heartbeat(deps(), claim.task.id, {
        claimToken: claim.task.claimToken!,
        leaseSeconds: 60,
      });
      expect(beat.claimLeaseUntil!.getTime()).toBeGreaterThan(t1);
    });

    it('throws claim_token_mismatch (409) when the token is wrong', async () => {
      await taskService.enqueue(deps(), {
        kind: 'content.draft',
        priority: 0,
        payload: {},
        maxAttempts: 3,
      });
      const claim = await taskService.claimNext(deps(), { leaseSeconds: 30 });
      if (claim.idle) throw new Error('expected claim');
      let err: unknown;
      try {
        await taskService.heartbeat(deps(), claim.task.id, {
          claimToken: '00000000-0000-0000-0000-000000000000',
          leaseSeconds: 60,
        });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('claim_token_mismatch');
      expect((err as AppError).status).toBe(409);
    });
  });

  describe('complete', () => {
    it('settles the task with succeeded status and stores result', async () => {
      await taskService.enqueue(deps(), {
        kind: 'content.draft',
        priority: 0,
        payload: {},
        maxAttempts: 3,
      });
      const claim = await taskService.claimNext(deps(), { leaseSeconds: 30 });
      if (claim.idle) throw new Error('expected claim');
      const out = await taskService.complete(deps(), claim.task.id, {
        claimToken: claim.task.claimToken!,
        result: { url: 'https://x' },
      });
      expect(out.status).toBe('succeeded');
      expect(out.result).toEqual({ url: 'https://x' });
      expect(out.finishedAt).toBeInstanceOf(Date);
      expect(out.claimToken).toBeNull();
    });

    it('rejects double-complete with claim_token_mismatch', async () => {
      await taskService.enqueue(deps(), {
        kind: 'content.draft',
        priority: 0,
        payload: {},
        maxAttempts: 3,
      });
      const claim = await taskService.claimNext(deps(), { leaseSeconds: 30 });
      if (claim.idle) throw new Error('expected claim');
      await taskService.complete(deps(), claim.task.id, {
        claimToken: claim.task.claimToken!,
      });
      let err: unknown;
      try {
        await taskService.complete(deps(), claim.task.id, {
          claimToken: claim.task.claimToken!,
        });
      } catch (e) {
        err = e;
      }
      expect((err as AppError).code).toBe('claim_token_mismatch');
    });
  });

  describe('fail', () => {
    it('with retry=true and attempts < max → bounces to queued with backoff', async () => {
      await taskService.enqueue(deps(), {
        kind: 'content.draft',
        priority: 0,
        payload: {},
        maxAttempts: 3,
      });
      const claim = await taskService.claimNext(deps(), { leaseSeconds: 30 });
      if (claim.idle) throw new Error('expected claim');
      const out = await taskService.fail(deps(), claim.task.id, {
        claimToken: claim.task.claimToken!,
        error: 'transient',
        retry: true,
      });
      expect(out.status).toBe('queued');
      expect(out.lastError).toBe('transient');
      expect(out.claimToken).toBeNull();
      expect(out.availableAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('with retry=true but attempts already at max → terminates as failed', async () => {
      await taskService.enqueue(deps(), {
        kind: 'content.draft',
        priority: 0,
        payload: {},
        maxAttempts: 1, // first claim already exhausts
      });
      const claim = await taskService.claimNext(deps(), { leaseSeconds: 30 });
      if (claim.idle) throw new Error('expected claim');
      const out = await taskService.fail(deps(), claim.task.id, {
        claimToken: claim.task.claimToken!,
        error: 'kaboom',
        retry: true,
      });
      expect(out.status).toBe('failed');
      expect(out.lastError).toBe('kaboom');
    });

    it('with retry=false → forces terminal failed regardless of attempts left', async () => {
      await taskService.enqueue(deps(), {
        kind: 'content.draft',
        priority: 0,
        payload: {},
        maxAttempts: 5,
      });
      const claim = await taskService.claimNext(deps(), { leaseSeconds: 30 });
      if (claim.idle) throw new Error('expected claim');
      const out = await taskService.fail(deps(), claim.task.id, {
        claimToken: claim.task.claimToken!,
        error: 'do not retry',
        retry: false,
      });
      expect(out.status).toBe('failed');
    });

    it('returns 409 when claimToken does not match', async () => {
      await taskService.enqueue(deps(), {
        kind: 'content.draft',
        priority: 0,
        payload: {},
        maxAttempts: 3,
      });
      const claim = await taskService.claimNext(deps(), { leaseSeconds: 30 });
      if (claim.idle) throw new Error('expected claim');
      let err: unknown;
      try {
        await taskService.fail(deps(), claim.task.id, {
          claimToken: '00000000-0000-0000-0000-000000000000',
          error: 'x',
          retry: true,
        });
      } catch (e) {
        err = e;
      }
      expect((err as AppError).status).toBe(409);
      expect((err as AppError).code).toBe('claim_token_mismatch');
    });
  });

  describe('patch', () => {
    it('cancels a queued task', async () => {
      const a = await taskService.enqueue(deps(), {
        kind: 'content.draft',
        priority: 0,
        payload: {},
        maxAttempts: 3,
      });
      const out = await taskService.patch(deps(), a.task.id, { status: 'cancelled' });
      expect(out.status).toBe('cancelled');
      expect(out.finishedAt).toBeInstanceOf(Date);
    });

    it('cancels a claimed task and clears the claim_token (so the agent gets 409 on heartbeat)', async () => {
      await taskService.enqueue(deps(), {
        kind: 'content.draft',
        priority: 0,
        payload: {},
        maxAttempts: 3,
      });
      const claim = await taskService.claimNext(deps(), { leaseSeconds: 30 });
      if (claim.idle) throw new Error('expected claim');
      const cancelled = await taskService.patch(deps(), claim.task.id, { status: 'cancelled' });
      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.claimToken).toBeNull();

      let err: unknown;
      try {
        await taskService.heartbeat(deps(), claim.task.id, {
          claimToken: claim.task.claimToken!,
          leaseSeconds: 30,
        });
      } catch (e) {
        err = e;
      }
      expect((err as AppError).code).toBe('claim_token_mismatch');
    });

    it('refuses to cancel a terminal task', async () => {
      const a = await taskService.enqueue(deps(), {
        kind: 'content.draft',
        priority: 0,
        payload: {},
        maxAttempts: 3,
      });
      await taskRepo.update(handle.db as never, a.task.id, {
        status: 'succeeded',
        finishedAt: new Date(),
      });
      let err: unknown;
      try {
        await taskService.patch(deps(), a.task.id, { status: 'cancelled' });
      } catch (e) {
        err = e;
      }
      expect((err as AppError).code).toBe('conflict');
      expect((err as AppError).status).toBe(409);
    });

    it('reschedules a queued task', async () => {
      const a = await taskService.enqueue(deps(), {
        kind: 'content.draft',
        priority: 0,
        payload: {},
        maxAttempts: 3,
      });
      const future = new Date(Date.now() + 60_000).toISOString();
      const out = await taskService.patch(deps(), a.task.id, { availableAt: future });
      expect(Math.abs(out.availableAt.getTime() - new Date(future).getTime())).toBeLessThan(5);
    });

    it('refuses to reschedule a non-queued task', async () => {
      await taskService.enqueue(deps(), {
        kind: 'content.draft',
        priority: 0,
        payload: {},
        maxAttempts: 3,
      });
      const claim = await taskService.claimNext(deps(), { leaseSeconds: 30 });
      if (claim.idle) throw new Error('expected claim');
      let err: unknown;
      try {
        await taskService.patch(deps(), claim.task.id, {
          availableAt: new Date(Date.now() + 60_000).toISOString(),
        });
      } catch (e) {
        err = e;
      }
      expect((err as AppError).code).toBe('conflict');
    });
  });

  describe('sweepExpired', () => {
    it('requeues / expires past-due claimed rows', async () => {
      // Two queued rows, one with maxAttempts=1 so it'll terminate, one with 3 to requeue.
      const a = await taskService.enqueue(deps(), {
        kind: 'content.draft',
        priority: 0,
        payload: {},
        maxAttempts: 1,
      });
      const b = await taskService.enqueue(deps(), {
        kind: 'content.draft',
        priority: 0,
        payload: {},
        maxAttempts: 3,
      });
      const ca = await taskService.claimNext(deps(), { leaseSeconds: 1 });
      const cb = await taskService.claimNext(deps(), { leaseSeconds: 1 });
      if (ca.idle || cb.idle) throw new Error('expected both claims');
      // Force both leases into the past.
      const past = new Date(Date.now() - 1_000);
      await taskRepo.update(handle.db as never, ca.task.id, { claimLeaseUntil: past });
      await taskRepo.update(handle.db as never, cb.task.id, { claimLeaseUntil: past });

      const out = await taskService.sweepExpired(deps());
      expect(out).toEqual({ requeued: 1, expired: 1 });

      const freshA = await taskRepo.getById(handle.db as never, a.task.id);
      const freshB = await taskRepo.getById(handle.db as never, b.task.id);
      expect(freshA?.status).toBe('expired');
      expect(freshB?.status).toBe('queued');
    });
  });

  describe('list + getById', () => {
    it('list returns paginated rows; getById round-trips or 404', async () => {
      for (let i = 0; i < 3; i++) {
        await taskService.enqueue(deps(), {
          kind: 'content.draft',
          priority: 0,
          payload: { i },
          maxAttempts: 3,
        });
      }
      const page = await taskService.list(deps(), { page: 1, limit: 10 });
      expect(page.total).toBe(3);
      const fetched = await taskService.getById(deps(), page.items[0]!.id);
      expect(fetched.id).toBe(page.items[0]!.id);

      let err: unknown;
      try {
        await taskService.getById(deps(), '00000000-0000-0000-0000-000000000000');
      } catch (e) {
        err = e;
      }
      expect((err as AppError).status).toBe(404);
    });

    // sanity assertion that the tasks barrel surface is stable
    it('the schema export is reachable from the test', () => {
      expect(tasksTable).toBeDefined();
    });
  });
});
