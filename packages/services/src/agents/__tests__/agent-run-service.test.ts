import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentRunRepo, apiKeys } from '@siteops/db';
import { createTestDb, type TestDbHandle } from '@siteops/db/testing';
import { generateApiKey } from '@siteops/shared';

import { agentRunService } from '../agent-run-service.js';

let handle: TestDbHandle;
const deps = () => ({ db: handle.db as never });

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

describe('agentRunService', () => {
  beforeEach(async () => {
    if (!handle) handle = await createTestDb();
    await handle.reset();
  });

  afterAll(async () => {
    if (handle) await handle.close();
  });

  describe('record', () => {
    it('persists a single row with all the fields populated', async () => {
      const keyId = await seedKey('a');
      await agentRunService.record(deps(), {
        apiKeyId: keyId,
        agentName: 'agent-a',
        action: 'errors.report',
        status: 'success',
        durationMs: 42,
        input: { sample: 1 },
        output: { ok: true },
      });
      const page = await agentRunRepo.list(handle.db as never);
      expect(page.items).toHaveLength(1);
      expect(page.items[0]?.action).toBe('errors.report');
      expect(page.items[0]?.input).toEqual({ sample: 1 });
      expect(page.items[0]?.output).toEqual({ ok: true });
      expect(page.items[0]?.durationMs).toBe(42);
    });
  });

  describe('wrap', () => {
    it('records success path with the resolved value as output', async () => {
      const keyId = await seedKey('a');
      const result = await agentRunService.wrap(
        deps(),
        { apiKeyId: keyId, agentName: 'agent-a', action: 'tasks.complete', input: { id: 'x' } },
        async () => {
          // Pretend the handler returns the task envelope.
          return { taskId: 't-1', status: 'succeeded' };
        },
      );
      expect(result).toEqual({ taskId: 't-1', status: 'succeeded' });

      const page = await agentRunRepo.list(handle.db as never);
      expect(page.items).toHaveLength(1);
      const row = page.items[0]!;
      expect(row.status).toBe('success');
      expect(row.action).toBe('tasks.complete');
      expect(row.input).toEqual({ id: 'x' });
      expect(row.output).toEqual({ taskId: 't-1', status: 'succeeded' });
      expect(row.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('records failed path with the error message + re-throws', async () => {
      const keyId = await seedKey('a');
      const boom = new Error('kaboom');
      let caught: unknown;
      try {
        await agentRunService.wrap(
          deps(),
          { apiKeyId: keyId, agentName: 'agent-a', action: 'tasks.fail' },
          async () => {
            throw boom;
          },
        );
      } catch (e) {
        caught = e;
      }
      expect(caught).toBe(boom);

      const page = await agentRunRepo.list(handle.db as never);
      expect(page.items).toHaveLength(1);
      const row = page.items[0]!;
      expect(row.status).toBe('failed');
      expect(row.output).toEqual({ error: 'kaboom' });
    });

    it('measures a non-zero duration when the wrapped fn awaits', async () => {
      const keyId = await seedKey('a');
      await agentRunService.wrap(
        deps(),
        { apiKeyId: keyId, agentName: 'a', action: 'op.slow' },
        async () => {
          await new Promise((r) => setTimeout(r, 15));
          return { ok: true };
        },
      );
      const page = await agentRunRepo.list(handle.db as never);
      expect(page.items[0]!.durationMs!).toBeGreaterThanOrEqual(10);
    });

    it('does NOT swallow the wrapped fn return when record() throws', async () => {
      // Force the repo write to throw — wrap() must still return the resolved
      // value (the audit log is best-effort).
      const spy = vi.spyOn(agentRunRepo, 'create').mockRejectedValueOnce(new Error('db down'));
      const keyId = await seedKey('a');

      const events: Array<{ obj: Record<string, unknown> }> = [];
      const customLogger = {
        info: () => {},
        warn: (obj: Record<string, unknown>) => events.push({ obj }),
      };

      const result = await agentRunService.wrap(
        { db: handle.db as never, logger: customLogger },
        { apiKeyId: keyId, agentName: 'a', action: 'op.x' },
        async () => 'OK' as const,
      );
      expect(result).toBe('OK');
      expect(events.some((e) => e.obj['event'] === 'agent_run.record_failed')).toBe(true);
      spy.mockRestore();
    });

    it('does NOT swallow the original throw when record() throws on the failed path', async () => {
      const spy = vi.spyOn(agentRunRepo, 'create').mockRejectedValueOnce(new Error('db down'));
      const keyId = await seedKey('a');
      const boom = new Error('boom');

      let caught: unknown;
      try {
        await agentRunService.wrap(
          deps(),
          { apiKeyId: keyId, agentName: 'a', action: 'op.y' },
          async () => {
            throw boom;
          },
        );
      } catch (e) {
        caught = e;
      }
      expect(caught).toBe(boom);
      spy.mockRestore();
    });
  });

  describe('summary', () => {
    it('proxies to the repo', async () => {
      const out = await agentRunService.summary(deps());
      expect(out.total).toBe(0);
    });
  });

  describe('getById', () => {
    it('throws 404 on missing id', async () => {
      let err: unknown;
      try {
        await agentRunService.getById(deps(), '00000000-0000-0000-0000-000000000000');
      } catch (e) {
        err = e;
      }
      expect((err as { status: number }).status).toBe(404);
    });
  });
});
