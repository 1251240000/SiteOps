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
