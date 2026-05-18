/**
 * Housekeeping wiring smoke test.
 *
 * We don't re-test pruning logic (that lives in the repo tests). The goal
 * here is to lock down that the daily pass actually invokes
 * `taskService.sweepExpired` and reflects the counts in the result so
 * downstream observability (logs / Slack reports) stays correct.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db.js', () => ({ getWorkerDb: vi.fn() }));
vi.mock('../../logger.js', () => ({ getWorkerLogger: vi.fn() }));

import {
  agentRuns as agentRunsTable,
  apiKeys as apiKeysTable,
  tasks as tasksTable,
  taskRepo,
  webhookEvents as webhookEventsTable,
} from '@siteops/db';
import { createTestDb, type TestDbHandle } from '@siteops/db/testing';

import { getWorkerDb } from '../../db.js';
import { getWorkerLogger } from '../../logger.js';
import { processHousekeeping } from '../housekeeping.js';

let handle: TestDbHandle;

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => noopLogger,
};

beforeAll(async () => {
  handle = await createTestDb();
  vi.mocked(getWorkerDb as () => unknown).mockReturnValue(handle.db);
  vi.mocked(getWorkerLogger as () => unknown).mockReturnValue(noopLogger);
});

beforeEach(async () => {
  await handle.reset();
});

afterAll(async () => {
  await handle.close();
  vi.restoreAllMocks();
});

describe('processHousekeeping', () => {
  it('returns zero counters on a quiet system', async () => {
    const out = await processHousekeeping();
    expect(out).toEqual({
      prunedUptime: 0,
      prunedErrors: 0,
      tasksRequeued: 0,
      tasksExpired: 0,
      prunedAgentRuns: 0,
      prunedWebhookEvents: 0,
    });
  });

  it('prunes processed webhook_events older than the retention window', async () => {
    // 90-day default retention; seed one ancient processed row + one fresh +
    // one signature-failed row (must NOT be pruned regardless of age).
    const oldDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
    const freshDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    await handle.db.insert(webhookEventsTable).values([
      {
        provider: 'github',
        eventType: 'workflow_run',
        deliveryId: 'old-processed',
        signatureOk: true,
        payload: { x: 1 },
        processedAt: oldDate,
        createdAt: oldDate,
      },
      {
        provider: 'github',
        eventType: 'workflow_run',
        deliveryId: 'fresh-processed',
        signatureOk: true,
        payload: { x: 2 },
        processedAt: freshDate,
        createdAt: freshDate,
      },
      {
        provider: 'github',
        eventType: 'workflow_run',
        deliveryId: 'old-bad-sig',
        signatureOk: false,
        payload: { x: 3 },
        createdAt: oldDate,
      },
    ]);

    const out = await processHousekeeping();
    expect(out.prunedWebhookEvents).toBe(1);

    const remaining = await handle.db.select().from(webhookEventsTable);
    expect(remaining.map((r) => r.deliveryId).sort()).toEqual(['fresh-processed', 'old-bad-sig']);
  });

  it('prunes agent_runs rows older than the retention window', async () => {
    // Seed an api key + one ancient + one fresh agent_run row. The default
    // retention is 90 days, so 200 days old must be pruned and 1 day old must stay.
    const [key] = await handle.db
      .insert(apiKeysTable)
      .values({
        name: 'housekeeping-fixture',
        keyHash: 'bcrypt$placeholder',
        keyPrefix: 'sk_test_',
        scopes: ['errors:write'],
      })
      .returning({ id: apiKeysTable.id });
    if (!key) throw new Error('seed api key');

    const oldDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
    const freshDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await handle.db.insert(agentRunsTable).values([
      {
        apiKeyId: key.id,
        agentName: 'old-agent',
        action: 'errors.report',
        status: 'success',
        createdAt: oldDate,
      },
      {
        apiKeyId: key.id,
        agentName: 'fresh-agent',
        action: 'errors.report',
        status: 'success',
        createdAt: freshDate,
      },
    ]);

    const out = await processHousekeeping();
    expect(out.prunedAgentRuns).toBe(1);

    const remaining = await handle.db.select().from(agentRunsTable);
    expect(remaining.map((r) => r.agentName)).toEqual(['fresh-agent']);
  });

  it('requeues a claimed task whose lease is past-due', async () => {
    // Seed a queued task, claim it, then expire the lease in the past.
    await handle.db.insert(tasksTable).values({ kind: 'content.draft', maxAttempts: 3 });
    const claim = await taskRepo.claimNext(handle.db as never, { leaseSeconds: 1 });
    if (!claim) throw new Error('expected claim');
    await taskRepo.update(handle.db as never, claim.id, {
      claimLeaseUntil: new Date(Date.now() - 1_000),
    });

    const out = await processHousekeeping();
    expect(out.tasksRequeued).toBe(1);
    expect(out.tasksExpired).toBe(0);

    const fresh = await taskRepo.getById(handle.db as never, claim.id);
    expect(fresh?.status).toBe('queued');
  });

  it('expires a claimed task whose attempts are already at max', async () => {
    const [row] = await handle.db
      .insert(tasksTable)
      .values({
        kind: 'content.draft',
        maxAttempts: 1,
        attempts: 1,
        status: 'claimed',
        claimToken: '11111111-1111-4111-8111-111111111111',
        claimLeaseUntil: new Date(Date.now() - 1_000),
      })
      .returning();
    if (!row) throw new Error('seed');

    const out = await processHousekeeping();
    expect(out.tasksExpired).toBe(1);
    expect(out.tasksRequeued).toBe(0);

    const fresh = await taskRepo.getById(handle.db as never, row.id);
    expect(fresh?.status).toBe('expired');
    expect(fresh?.lastError).toBe('lease expired');
  });
});
