/**
 * Route-handler tests for `/api/v1/tasks/*`.
 *
 * Exercises both the dashboard side (session-authed `withAuth` paths) and
 * the agent side (Bearer key `withApiKey` paths). Uses a real PGlite handle
 * so the dedupe partial-unique index and the `FOR UPDATE SKIP LOCKED` claim
 * machinery are actually exercised end-to-end.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/db', () => ({ getDb: vi.fn() }));

import { apiKeys } from '@siteops/db';
import { generateApiKey } from '@siteops/shared';

import { GET as listTasks, POST as createTask } from '@/app/api/v1/tasks/route';
import { GET as getTask, PATCH as patchTask } from '@/app/api/v1/tasks/[id]/route';
import { POST as claimTask } from '@/app/api/v1/tasks/claim/route';
import { POST as heartbeat } from '@/app/api/v1/tasks/[id]/heartbeat/route';
import { POST as complete } from '@/app/api/v1/tasks/[id]/complete/route';
import { POST as failTask } from '@/app/api/v1/tasks/[id]/fail/route';

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

type Task = {
  id: string;
  kind: string;
  status: string;
  claimToken: string | null;
  attempts: number;
  maxAttempts: number;
  availableAt: string;
};

async function seedApiKey(scopes: string[]): Promise<string> {
  const handle = await setupTestDb();
  const generated = await generateApiKey();
  await handle.db.insert(apiKeys).values({
    name: 'test-agent',
    keyHash: generated.hash,
    keyPrefix: generated.prefix,
    scopes,
  });
  return generated.plaintext;
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

describe('POST /api/v1/tasks (enqueue)', () => {
  it('returns 401 without a session or key', async () => {
    await setSession(null);
    const req = await buildRequest('http://localhost/api/v1/tasks', {
      method: 'POST',
      body: { kind: 'content.draft' },
    });
    const res = await createTask(req);
    expect(res.status).toBe(401);
  });

  it('creates a new task and returns 201 + meta.created=true', async () => {
    const req = await buildRequest('http://localhost/api/v1/tasks', {
      method: 'POST',
      body: { kind: 'content.draft', priority: 5 },
    });
    const res = await createTask(req);
    expect(res.status).toBe(201);
    const body = await readJson<{
      data: Task;
      meta: { created: boolean; idempotent: boolean };
    }>(res);
    expect(body.data.kind).toBe('content.draft');
    expect(body.data.status).toBe('queued');
    expect(body.meta.created).toBe(true);
    expect(body.meta.idempotent).toBe(false);
  });

  it('treats the same dedupeKey as idempotent (200 + meta.idempotent=true)', async () => {
    const payload = { kind: 'audit.run', dedupeKey: 'audit:s1:2026-05-17' };
    const first = await createTask(
      await buildRequest('http://localhost/api/v1/tasks', { method: 'POST', body: payload }),
    );
    expect(first.status).toBe(201);
    const firstBody = await readJson<{ data: Task }>(first);

    const second = await createTask(
      await buildRequest('http://localhost/api/v1/tasks', { method: 'POST', body: payload }),
    );
    expect(second.status).toBe(200);
    const secondBody = await readJson<{
      data: Task;
      meta: { created: boolean; idempotent: boolean };
    }>(second);
    expect(secondBody.data.id).toBe(firstBody.data.id);
    expect(secondBody.meta.idempotent).toBe(true);

    const list = await listTasks(await buildRequest('http://localhost/api/v1/tasks'));
    const listBody = await readJson<{ meta: { total: number } }>(list);
    expect(listBody.meta.total).toBe(1);
  });

  it('rejects an invalid kind with 400 validation_failed', async () => {
    const req = await buildRequest('http://localhost/api/v1/tasks', {
      method: 'POST',
      body: { kind: 'NOT VALID' },
    });
    const res = await createTask(req);
    expect(res.status).toBe(400);
    const body = await readJson<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('validation_failed');
  });
});

describe('GET /api/v1/tasks', () => {
  it('returns 401 without auth', async () => {
    await setSession(null);
    const res = await listTasks(await buildRequest('http://localhost/api/v1/tasks'));
    expect(res.status).toBe(401);
  });

  it('paginates + filters', async () => {
    for (let i = 0; i < 3; i++) {
      await createTask(
        await buildRequest('http://localhost/api/v1/tasks', {
          method: 'POST',
          body: { kind: i === 0 ? 'audit.run' : 'content.draft' },
        }),
      );
    }
    const drafts = await listTasks(
      await buildRequest('http://localhost/api/v1/tasks?kind=content.draft'),
    );
    const body = await readJson<{ data: Task[]; meta: { total: number } }>(drafts);
    expect(body.meta.total).toBe(2);
    expect(body.data.every((t) => t.kind === 'content.draft')).toBe(true);
  });
});

describe('GET / PATCH /api/v1/tasks/:id', () => {
  async function enqueue(): Promise<string> {
    const res = await createTask(
      await buildRequest('http://localhost/api/v1/tasks', {
        method: 'POST',
        body: { kind: 'content.draft' },
      }),
    );
    const body = await readJson<{ data: Task }>(res);
    return body.data.id;
  }

  it('GET returns the task', async () => {
    const id = await enqueue();
    const res = await getTask(
      await buildRequest(`http://localhost/api/v1/tasks/${id}`),
      routeContext({ id }),
    );
    expect(res.status).toBe(200);
    const body = await readJson<{ data: Task }>(res);
    expect(body.data.id).toBe(id);
  });

  it('GET returns 400 for an invalid id (Zod)', async () => {
    const res = await getTask(
      await buildRequest('http://localhost/api/v1/tasks/not-a-uuid'),
      routeContext({ id: 'not-a-uuid' }),
    );
    expect(res.status).toBe(400);
  });

  it('PATCH cancels a queued task', async () => {
    const id = await enqueue();
    const res = await patchTask(
      await buildRequest(`http://localhost/api/v1/tasks/${id}`, {
        method: 'PATCH',
        body: { status: 'cancelled' },
      }),
      routeContext({ id }),
    );
    expect(res.status).toBe(200);
    const body = await readJson<{ data: Task }>(res);
    expect(body.data.status).toBe('cancelled');
  });

  it('PATCH rejects an empty body with 400', async () => {
    const id = await enqueue();
    const res = await patchTask(
      await buildRequest(`http://localhost/api/v1/tasks/${id}`, {
        method: 'PATCH',
        body: {},
      }),
      routeContext({ id }),
    );
    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/tasks/claim (agent only)', () => {
  it('returns 401 without a Bearer key', async () => {
    await setSession(null);
    const res = await claimTask(
      await buildRequest('http://localhost/api/v1/tasks/claim', {
        method: 'POST',
        body: { leaseSeconds: 30 },
      }),
    );
    expect(res.status).toBe(401);
  });

  it('rejects a session-only caller (no key) with 401', async () => {
    // A logged-in admin without a key cannot pull tasks; the route is
    // strictly key-authed so a missing Authorization header is 401.
    const res = await claimTask(
      await buildRequest('http://localhost/api/v1/tasks/claim', {
        method: 'POST',
        body: { leaseSeconds: 30 },
      }),
    );
    expect(res.status).toBe(401);
  });

  it('rejects a key without `tasks:claim` scope with 403', async () => {
    const plaintext = await seedApiKey(['tasks:read']);
    const res = await claimTask(
      await buildRequest('http://localhost/api/v1/tasks/claim', {
        method: 'POST',
        body: { leaseSeconds: 30 },
        headers: { authorization: `Bearer ${plaintext}` },
      }),
    );
    expect(res.status).toBe(403);
  });

  it('returns 200 + idle:true on an empty queue', async () => {
    const plaintext = await seedApiKey(['tasks:claim']);
    const res = await claimTask(
      await buildRequest('http://localhost/api/v1/tasks/claim', {
        method: 'POST',
        body: { leaseSeconds: 30 },
        headers: { authorization: `Bearer ${plaintext}` },
      }),
    );
    expect(res.status).toBe(200);
    const body = await readJson<{ data: unknown; meta: { idle: boolean } }>(res);
    expect(body.meta.idle).toBe(true);
    expect(body.data).toBeNull();
  });

  it('round-trip: enqueue → claim → heartbeat → complete', async () => {
    // Enqueue via session.
    const enqRes = await createTask(
      await buildRequest('http://localhost/api/v1/tasks', {
        method: 'POST',
        body: { kind: 'content.draft' },
      }),
    );
    const enq = await readJson<{ data: Task }>(enqRes);
    const taskId = enq.data.id;

    // Claim via API key.
    const plaintext = await seedApiKey(['tasks:claim']);
    const claimRes = await claimTask(
      await buildRequest('http://localhost/api/v1/tasks/claim', {
        method: 'POST',
        body: { leaseSeconds: 30 },
        headers: { authorization: `Bearer ${plaintext}` },
      }),
    );
    const claimBody = await readJson<{ data: Task; meta: { idle: boolean } }>(claimRes);
    expect(claimBody.meta.idle).toBe(false);
    expect(claimBody.data.id).toBe(taskId);
    expect(typeof claimBody.data.claimToken).toBe('string');
    expect(claimBody.data.attempts).toBe(1);
    const claimToken = claimBody.data.claimToken!;

    // Heartbeat.
    const beat = await heartbeat(
      await buildRequest(`http://localhost/api/v1/tasks/${taskId}/heartbeat`, {
        method: 'POST',
        body: { claimToken, leaseSeconds: 60 },
        headers: { authorization: `Bearer ${plaintext}` },
      }),
      routeContext({ id: taskId }),
    );
    expect(beat.status).toBe(200);

    // Complete.
    const done = await complete(
      await buildRequest(`http://localhost/api/v1/tasks/${taskId}/complete`, {
        method: 'POST',
        body: { claimToken, result: { url: 'https://x' } },
        headers: { authorization: `Bearer ${plaintext}` },
      }),
      routeContext({ id: taskId }),
    );
    expect(done.status).toBe(200);
    const doneBody = await readJson<{ data: Task }>(done);
    expect(doneBody.data.status).toBe('succeeded');
  });

  it('heartbeat with mismatched claimToken returns 409', async () => {
    await createTask(
      await buildRequest('http://localhost/api/v1/tasks', {
        method: 'POST',
        body: { kind: 'content.draft' },
      }),
    );
    const plaintext = await seedApiKey(['tasks:claim']);
    const claim = await claimTask(
      await buildRequest('http://localhost/api/v1/tasks/claim', {
        method: 'POST',
        body: { leaseSeconds: 30 },
        headers: { authorization: `Bearer ${plaintext}` },
      }),
    );
    const claimBody = await readJson<{ data: Task }>(claim);

    const res = await heartbeat(
      await buildRequest(`http://localhost/api/v1/tasks/${claimBody.data.id}/heartbeat`, {
        method: 'POST',
        body: { claimToken: '00000000-0000-0000-0000-000000000000', leaseSeconds: 30 },
        headers: { authorization: `Bearer ${plaintext}` },
      }),
      routeContext({ id: claimBody.data.id }),
    );
    expect(res.status).toBe(409);
    const body = await readJson<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('claim_token_mismatch');
  });

  it('fail with retry:true and attempts < max requeues the task', async () => {
    await createTask(
      await buildRequest('http://localhost/api/v1/tasks', {
        method: 'POST',
        body: { kind: 'content.draft', maxAttempts: 3 },
      }),
    );
    const plaintext = await seedApiKey(['tasks:claim']);
    const claim = await claimTask(
      await buildRequest('http://localhost/api/v1/tasks/claim', {
        method: 'POST',
        body: { leaseSeconds: 30 },
        headers: { authorization: `Bearer ${plaintext}` },
      }),
    );
    const claimBody = await readJson<{ data: Task }>(claim);
    const claimToken = claimBody.data.claimToken!;

    const failed = await failTask(
      await buildRequest(`http://localhost/api/v1/tasks/${claimBody.data.id}/fail`, {
        method: 'POST',
        body: { claimToken, error: 'transient', retry: true },
        headers: { authorization: `Bearer ${plaintext}` },
      }),
      routeContext({ id: claimBody.data.id }),
    );
    expect(failed.status).toBe(200);
    const failedBody = await readJson<{ data: Task }>(failed);
    expect(failedBody.data.status).toBe('queued');
  });
});
