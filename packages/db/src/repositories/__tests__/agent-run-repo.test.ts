import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { generateApiKey } from '@siteops/shared';

import { createTestDb, type TestDbHandle } from '../../testing.js';
import { agentRuns, type NewAgentRun } from '../../schema/agent-runs.js';
import { apiKeys } from '../../schema/api-keys.js';
import { agentRunRepo } from '../agent-run-repo.js';

let handle: TestDbHandle;

async function seedKey(name = 'agent-key'): Promise<string> {
  const generated = await generateApiKey();
  const [row] = await handle.db
    .insert(apiKeys)
    .values({
      name,
      keyHash: generated.hash,
      keyPrefix: generated.prefix,
      scopes: ['*'],
    })
    .returning({ id: apiKeys.id });
  if (!row) throw new Error('seedKey');
  return row.id;
}

async function seedRun(input: Partial<NewAgentRun> & { apiKeyId: string }): Promise<string> {
  const [row] = await handle.db
    .insert(agentRuns)
    .values({
      apiKeyId: input.apiKeyId,
      agentName: input.agentName ?? 'agent-a',
      action: input.action ?? 'tasks.claim',
      status: input.status ?? 'success',
      input: input.input ?? null,
      output: input.output ?? null,
      durationMs: input.durationMs ?? 10,
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    })
    .returning({ id: agentRuns.id });
  if (!row) throw new Error('seedRun');
  return row.id;
}

describe('agentRunRepo', () => {
  beforeEach(async () => {
    if (!handle) handle = await createTestDb();
    await handle.reset();
  });

  afterAll(async () => {
    if (handle) await handle.close();
  });

  describe('create + getByIdWithKey', () => {
    it('inserts a row and joins api_keys.name on read', async () => {
      const keyId = await seedKey('reporting-agent');
      const created = await agentRunRepo.create(handle.db as never, {
        apiKeyId: keyId,
        agentName: 'agent-a',
        action: 'errors.report',
        status: 'success',
        durationMs: 42,
      });
      expect(created.id).toBeTypeOf('string');

      const fetched = await agentRunRepo.getByIdWithKey(handle.db as never, created.id);
      expect(fetched?.action).toBe('errors.report');
      expect(fetched?.apiKey).toEqual({ id: keyId, name: 'reporting-agent' });

      expect(
        await agentRunRepo.getByIdWithKey(
          handle.db as never,
          '00000000-0000-0000-0000-000000000000',
        ),
      ).toBeNull();
    });
  });

  describe('list filters', () => {
    it('filters by status / action exact + prefix / apiKeyId / time range', async () => {
      const keyA = await seedKey('a');
      const keyB = await seedKey('b');
      await seedRun({ apiKeyId: keyA, action: 'tasks.claim', status: 'success' });
      await seedRun({ apiKeyId: keyA, action: 'tasks.complete', status: 'failed' });
      await seedRun({ apiKeyId: keyB, action: 'errors.report', status: 'success' });

      const failed = await agentRunRepo.list(handle.db as never, {
        filters: { status: 'failed' },
      });
      expect(failed.items.map((r) => r.action)).toEqual(['tasks.complete']);

      const allTasks = await agentRunRepo.list(handle.db as never, {
        filters: { action: 'tasks.*' },
      });
      expect(allTasks.total).toBe(2);
      expect(new Set(allTasks.items.map((r) => r.action))).toEqual(
        new Set(['tasks.claim', 'tasks.complete']),
      );

      const exact = await agentRunRepo.list(handle.db as never, {
        filters: { action: 'errors.report' },
      });
      expect(exact.items).toHaveLength(1);

      const onlyB = await agentRunRepo.list(handle.db as never, { filters: { apiKeyId: keyB } });
      expect(onlyB.items).toHaveLength(1);
      expect(onlyB.items[0]?.apiKey?.name).toBe('b');

      const future = new Date(Date.now() + 86_400_000);
      const noneInFuture = await agentRunRepo.list(handle.db as never, {
        filters: { from: future },
      });
      expect(noneInFuture.total).toBe(0);
    });

    it('sorts -created_at by default; page/limit honored', async () => {
      const keyId = await seedKey('a');
      for (let i = 0; i < 5; i++) {
        await seedRun({ apiKeyId: keyId, action: `op.${i}` });
        await new Promise((r) => setTimeout(r, 5));
      }
      const page1 = await agentRunRepo.list(handle.db as never, { page: 1, limit: 2 });
      expect(page1.items).toHaveLength(2);
      expect(page1.total).toBe(5);
      // Newest first → most recent action should be op.4.
      expect(page1.items[0]?.action).toBe('op.4');

      const page2 = await agentRunRepo.list(handle.db as never, { page: 2, limit: 2 });
      const overlap = new Set([...page1.items.map((r) => r.id), ...page2.items.map((r) => r.id)]);
      expect(overlap.size).toBe(4); // 2+2 distinct
    });
  });

  describe('summary', () => {
    it('returns zeroed shape on an empty window', async () => {
      const out = await agentRunRepo.summary(handle.db as never);
      expect(out).toEqual({
        total: 0,
        succeeded: 0,
        failed: 0,
        p50DurationMs: null,
        p95DurationMs: null,
        activeKeys: 0,
      });
    });

    it('p50/p95 + failed_rate are stable over a fixed fixture', async () => {
      const keyA = await seedKey('a');
      const keyB = await seedKey('b');
      // 9 successes (10ms..90ms in 10ms steps) + 1 failure (1000ms).
      for (let i = 1; i <= 9; i++) {
        await seedRun({ apiKeyId: keyA, durationMs: i * 10, status: 'success' });
      }
      await seedRun({ apiKeyId: keyB, durationMs: 1000, status: 'failed' });

      const out = await agentRunRepo.summary(handle.db as never);
      expect(out.total).toBe(10);
      expect(out.succeeded).toBe(9);
      expect(out.failed).toBe(1);
      expect(out.activeKeys).toBe(2);
      // percentile_cont(0.5) on n=10 sorted values: position 0.5*(n-1)=4.5,
      // linear interpolation between sorted[4]=50 and sorted[5]=60 → 55.
      expect(out.p50DurationMs).toBe(55);
      // p95 is interpolated near the top — between 90 and 1000. Just assert
      // it sits between the highest "normal" and the outlier so the SQL is
      // doing percentile_cont and not a count.
      expect(out.p95DurationMs).toBeGreaterThan(90);
      expect(out.p95DurationMs).toBeLessThanOrEqual(1000);
    });
  });

  describe('cursor pagination', () => {
    it('walks the full table without duplicates or gaps and stops with hasMore=false', async () => {
      const keyId = await seedKey('cursor-walk');
      const ids: string[] = [];
      // Seed 11 rows so a limit=4 walk takes 3 pages (4+4+3) — including
      // the final page where hasMore must flip to false.
      for (let i = 0; i < 11; i++) {
        const id = await seedRun({ apiKeyId: keyId, action: `op.${i}` });
        ids.push(id);
        // Force monotonically increasing createdAt so the keyset order is
        // stable — without this, several rows can share the same ms.
        await new Promise((r) => setTimeout(r, 3));
      }

      const seen: string[] = [];
      let cursor: string | null | undefined;
      let hasMore = true;
      let pages = 0;
      while (hasMore) {
        pages += 1;
        if (pages > 10) throw new Error('infinite loop guard');
        const decoded = cursor
          ? // Decode here to avoid pulling in another helper from app code.
            JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
          : undefined;
        const page = await agentRunRepo.list(handle.db as never, {
          limit: 4,
          ...(decoded ? { cursor: decoded } : {}),
        });
        for (const row of page.items) seen.push(row.id);
        hasMore = page.hasMore;
        cursor = page.nextCursor;
        if (!hasMore) expect(page.nextCursor).toBeNull();
      }
      expect(pages).toBe(3);
      // Walked rows are the same set as the seeded ids, in newest-first order.
      expect(seen).toEqual([...ids].reverse());
      // No duplicates:
      expect(new Set(seen).size).toBe(seen.length);
    });

    it('does not skip rows inserted at the head mid-walk', async () => {
      const keyId = await seedKey('mid-walk');
      const beforeIds: string[] = [];
      for (let i = 0; i < 6; i++) {
        beforeIds.push(await seedRun({ apiKeyId: keyId, action: `before.${i}` }));
        await new Promise((r) => setTimeout(r, 3));
      }
      // First page (newest 3).
      const p1 = await agentRunRepo.list(handle.db as never, { limit: 3 });
      expect(p1.items.map((r) => r.id)).toEqual([...beforeIds].slice(-3).reverse());
      expect(p1.nextCursor).not.toBeNull();

      // Insert a brand new row AFTER the first page boundary. It must
      // NOT show up in the cursor follow-up — keyset semantics promise
      // forward-only progress through rows that existed at start of walk.
      await new Promise((r) => setTimeout(r, 3));
      await seedRun({ apiKeyId: keyId, action: 'inserted.after' });

      const decoded = JSON.parse(Buffer.from(p1.nextCursor!, 'base64url').toString('utf8'));
      const p2 = await agentRunRepo.list(handle.db as never, { limit: 3, cursor: decoded });
      // The follow-up MUST include only the older rows; never the new
      // one (which has a strictly newer createdAt).
      expect(p2.items.map((r) => r.action)).not.toContain('inserted.after');
      expect(p2.items).toHaveLength(3);
      expect(p2.hasMore).toBe(false);
    });

    it('returns empty page with hasMore=false when the cursor is past all rows', async () => {
      const keyId = await seedKey('past-end');
      await seedRun({ apiKeyId: keyId });
      // Forge a cursor that is older than every row in the table.
      const cursor = { id: '00000000-0000-0000-0000-000000000000', ts: '1970-01-01T00:00:00.000Z' };
      const out = await agentRunRepo.list(handle.db as never, { limit: 5, cursor });
      expect(out.items).toEqual([]);
      expect(out.hasMore).toBe(false);
      expect(out.nextCursor).toBeNull();
    });

    it('respects filters together with the keyset cursor', async () => {
      const keyId = await seedKey('cursor-filtered');
      // Mix successes and failures.
      for (let i = 0; i < 4; i++) {
        await seedRun({ apiKeyId: keyId, status: 'success' });
        await new Promise((r) => setTimeout(r, 2));
        await seedRun({ apiKeyId: keyId, status: 'failed' });
        await new Promise((r) => setTimeout(r, 2));
      }

      const seen: string[] = [];
      let cursor: string | null | undefined;
      let hasMore = true;
      while (hasMore) {
        const decoded = cursor
          ? JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
          : undefined;
        const page = await agentRunRepo.list(handle.db as never, {
          limit: 2,
          filters: { status: 'failed' },
          ...(decoded ? { cursor: decoded } : {}),
        });
        for (const row of page.items) {
          expect(row.status).toBe('failed');
          seen.push(row.id);
        }
        hasMore = page.hasMore;
        cursor = page.nextCursor;
      }
      expect(seen).toHaveLength(4);
      expect(new Set(seen).size).toBe(4);
    });

    it('clamps limit to [1, 100] in cursor mode', async () => {
      const keyId = await seedKey('clamp');
      await seedRun({ apiKeyId: keyId });
      const lo = await agentRunRepo.list(handle.db as never, { limit: 0 });
      expect(lo.limit).toBe(1);
      const hi = await agentRunRepo.list(handle.db as never, { limit: 9999 });
      expect(hi.limit).toBe(100);
    });
  });

  describe('pruneOlderThan', () => {
    it('deletes rows older than the cutoff', async () => {
      const keyId = await seedKey('a');
      await handle.db.insert(agentRuns).values({
        apiKeyId: keyId,
        agentName: 'a',
        action: 'op.old',
        status: 'success',
        durationMs: 1,
        createdAt: new Date(Date.now() - 200 * 86_400_000),
      });
      await seedRun({ apiKeyId: keyId, action: 'op.new' });

      const deleted = await agentRunRepo.pruneOlderThan(handle.db as never, 90);
      expect(deleted).toBe(1);

      const left = await agentRunRepo.list(handle.db as never);
      expect(left.items.map((r) => r.action)).toEqual(['op.new']);
    });
  });
});
