/**
 * Route-handler tests for `/api/v1/agent-runs/*`.
 *
 * Also exercises the `withApiKeyAudited` side-effect: every call to a route
 * that opted into the wrapper must land a row in `agent_runs` without
 * changing the user-visible response.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/db', () => ({ getDb: vi.fn() }));

import { agentRuns, apiKeys, sites } from '@siteops/db';
import { generateApiKey } from '@siteops/shared';

import { POST as createTask } from '@/app/api/v1/tasks/route';
import { POST as claimTask } from '@/app/api/v1/tasks/claim/route';
import { POST as complete } from '@/app/api/v1/tasks/[id]/complete/route';
import { POST as reportError } from '@/app/api/v1/errors/route';
import { GET as listAgentRuns } from '@/app/api/v1/agent-runs/route';
import { GET as getAgentRun } from '@/app/api/v1/agent-runs/[id]/route';
import { GET as agentRunsSummary } from '@/app/api/v1/agent-runs/summary/route';

import {
  bindDbMock,
  buildRequest,
  FAKE_SESSION,
  readJson,
  resetDb,
  routeContext,
  setSession,
  setupTestDb,
} from '@/__tests__/helpers';

type AgentRunRow = {
  id: string;
  apiKeyId: string;
  apiKey: { id: string; name: string } | null;
  agentName: string;
  action: string;
  status: 'success' | 'failed';
  durationMs: number | null;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  createdAt: string;
};

async function seedApiKey(scopes: string[], name = 'test-agent'): Promise<string> {
  const handle = await setupTestDb();
  const generated = await generateApiKey();
  await handle.db.insert(apiKeys).values({
    name,
    keyHash: generated.hash,
    keyPrefix: generated.prefix,
    scopes,
  });
  return generated.plaintext;
}

async function seedSite(slug = 'audit-test'): Promise<string> {
  const handle = await setupTestDb();
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

/**
 * Wait for the `void agentRunService.record(...)` chain to land at least
 * `expected` rows in `agent_runs`. Polls every 10ms up to ~500ms; fails fast
 * if the audit pipeline is wedged.
 */
async function waitForAuditRows(expected: number): Promise<void> {
  const handle = await setupTestDb();
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    const rows = await handle.db.select({ id: agentRuns.id }).from(agentRuns);
    if (rows.length >= expected) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`audit rows never reached ${expected}`);
}

beforeAll(async () => {
  await setupTestDb();
  await bindDbMock();
});

beforeEach(async () => {
  await resetDb();
  await setSession(FAKE_SESSION);
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe('audit side-effect (withApiKeyAudited)', () => {
  it('lands an agent_runs row on a successful errors.report call without altering the response', async () => {
    const siteId = await seedSite('err-target');
    const key = await seedApiKey(['errors:write'], 'reporter');
    const res = await reportError(
      await buildRequest('http://localhost/api/v1/errors', {
        method: 'POST',
        body: { siteId, source: 'js', level: 'error', message: 'boom' },
        headers: { authorization: `Bearer ${key}` },
      }),
    );
    // User-visible response is unchanged from the pre-audit baseline.
    expect(res.status).toBe(201);

    await waitForAuditRows(1);
    const handle = await setupTestDb();
    const rows = await handle.db.select().from(agentRuns);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe('errors.report');
    expect(rows[0]?.status).toBe('success');
    expect(rows[0]?.agentName).toBe('reporter');
    expect(rows[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('records status=failed when the audited handler returns 4xx', async () => {
    const key = await seedApiKey(['errors:write']);
    const res = await reportError(
      await buildRequest('http://localhost/api/v1/errors', {
        method: 'POST',
        body: { not_a_valid_payload: true },
        headers: { authorization: `Bearer ${key}` },
      }),
    );
    expect(res.status).toBe(400);

    await waitForAuditRows(1);
    const handle = await setupTestDb();
    const rows = await handle.db.select().from(agentRuns);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe('errors.report');
    expect(rows[0]?.status).toBe('failed');
    // Failed-handler output captures the canonical error envelope (or null
    // if the body wasn't JSON-readable). Either way it must NOT be empty.
    expect(rows[0]?.output).not.toBeNull();
  });

  it('audits the full T25 round-trip (claim + complete) with distinct action labels', async () => {
    // Enqueue via the session-authed endpoint (NOT audited).
    const enqueueRes = await createTask(
      await buildRequest('http://localhost/api/v1/tasks', {
        method: 'POST',
        body: { kind: 'content.draft' },
      }),
    );
    expect(enqueueRes.status).toBe(201);
    const enqueueBody = await readJson<{ data: { id: string } }>(enqueueRes);
    const taskId = enqueueBody.data.id;

    const key = await seedApiKey(['tasks:claim'], 'worker-1');

    const claimRes = await claimTask(
      await buildRequest('http://localhost/api/v1/tasks/claim', {
        method: 'POST',
        body: { leaseSeconds: 30 },
        headers: { authorization: `Bearer ${key}` },
      }),
    );
    expect(claimRes.status).toBe(200);
    const claim = await readJson<{ data: { claimToken: string } }>(claimRes);

    const completeRes = await complete(
      await buildRequest(`http://localhost/api/v1/tasks/${taskId}/complete`, {
        method: 'POST',
        body: { claimToken: claim.data.claimToken, result: { url: 'https://x' } },
        headers: { authorization: `Bearer ${key}` },
      }),
      routeContext({ id: taskId }),
    );
    expect(completeRes.status).toBe(200);

    await waitForAuditRows(2);
    const handle = await setupTestDb();
    const rows = await handle.db.select().from(agentRuns);
    expect(rows).toHaveLength(2);
    const actions = rows.map((r) => r.action).sort();
    expect(actions).toEqual(['tasks.claim', 'tasks.complete']);
    expect(rows.every((r) => r.status === 'success')).toBe(true);
    expect(rows.every((r) => r.agentName === 'worker-1')).toBe(true);
  });
});

describe('GET /api/v1/agent-runs', () => {
  it('401 without a session', async () => {
    await setSession(null);
    const res = await listAgentRuns(await buildRequest('http://localhost/api/v1/agent-runs'));
    expect(res.status).toBe(401);
  });

  it('lists rows filtered by status and action prefix', async () => {
    const key = await seedApiKey(['errors:write']);
    // Mix of success / failed reports.
    await reportError(
      await buildRequest('http://localhost/api/v1/errors', {
        method: 'POST',
        body: { siteId: await seedSite('a'), source: 'js', level: 'error', message: 'x' },
        headers: { authorization: `Bearer ${key}` },
      }),
    );
    await reportError(
      await buildRequest('http://localhost/api/v1/errors', {
        method: 'POST',
        body: { wrong: true },
        headers: { authorization: `Bearer ${key}` },
      }),
    );
    await waitForAuditRows(2);

    const failedRes = await listAgentRuns(
      await buildRequest('http://localhost/api/v1/agent-runs?status=failed'),
    );
    const failedBody = await readJson<{ data: AgentRunRow[]; meta: { total: number } }>(failedRes);
    expect(failedBody.meta.total).toBe(1);
    expect(failedBody.data[0]?.status).toBe('failed');

    const prefixRes = await listAgentRuns(
      await buildRequest('http://localhost/api/v1/agent-runs?action=errors.*'),
    );
    const prefixBody = await readJson<{ meta: { total: number } }>(prefixRes);
    expect(prefixBody.meta.total).toBe(2);
  });

  it('400 on bogus query params', async () => {
    const res = await listAgentRuns(
      await buildRequest('http://localhost/api/v1/agent-runs?status=bogus'),
    );
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/agent-runs/:id', () => {
  it('returns the row with full input/output', async () => {
    const siteId = await seedSite('detail-target');
    const key = await seedApiKey(['errors:write'], 'detail-agent');
    await reportError(
      await buildRequest('http://localhost/api/v1/errors', {
        method: 'POST',
        body: { siteId, source: 'js', level: 'error', message: 'kaboom' },
        headers: { authorization: `Bearer ${key}` },
      }),
    );
    await waitForAuditRows(1);

    const handle = await setupTestDb();
    const [row] = await handle.db.select().from(agentRuns);
    expect(row).toBeDefined();

    const res = await getAgentRun(
      await buildRequest(`http://localhost/api/v1/agent-runs/${row!.id}`),
      routeContext({ id: row!.id }),
    );
    expect(res.status).toBe(200);
    const body = await readJson<{ data: AgentRunRow }>(res);
    expect(body.data.action).toBe('errors.report');
    expect(body.data.apiKey?.name).toBe('detail-agent');
    expect(body.data.input).toMatchObject({ source: 'js', message: 'kaboom' });
    expect(body.data.output).not.toBeNull();
  });

  it('404 on unknown id', async () => {
    const res = await getAgentRun(
      await buildRequest('http://localhost/api/v1/agent-runs/00000000-0000-4000-8000-000000000000'),
      routeContext({ id: '00000000-0000-4000-8000-000000000000' }),
    );
    expect(res.status).toBe(404);
  });

  it('400 on invalid id (Zod)', async () => {
    const res = await getAgentRun(
      await buildRequest('http://localhost/api/v1/agent-runs/not-a-uuid'),
      routeContext({ id: 'not-a-uuid' }),
    );
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/agent-runs/summary', () => {
  it('aggregates counts + percentiles', async () => {
    const siteId = await seedSite('sum-target');
    const key = await seedApiKey(['errors:write']);
    for (let i = 0; i < 3; i++) {
      await reportError(
        await buildRequest('http://localhost/api/v1/errors', {
          method: 'POST',
          body: { siteId, source: 'js', level: 'error', message: `m${i}` },
          headers: { authorization: `Bearer ${key}` },
        }),
      );
    }
    await waitForAuditRows(3);

    const res = await agentRunsSummary(
      await buildRequest('http://localhost/api/v1/agent-runs/summary'),
    );
    expect(res.status).toBe(200);
    const body = await readJson<{
      data: {
        total: number;
        succeeded: number;
        failed: number;
        p50DurationMs: number | null;
        p95DurationMs: number | null;
        activeKeys: number;
      };
    }>(res);
    expect(body.data.total).toBe(3);
    expect(body.data.succeeded).toBe(3);
    expect(body.data.failed).toBe(0);
    expect(body.data.activeKeys).toBe(1);
  });
});
