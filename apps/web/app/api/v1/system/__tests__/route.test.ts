/**
 * Route-handler tests for `/api/v1/system/version` and `/api/v1/system/jobs`
 * (T38).
 *
 * Strategy: mock `@/lib/auth` to drive the session check, mock
 * `@/lib/queues.getAllQueueStatuses` so we don't need a live Redis, and
 * exercise the route handler the same way the rest of the suite does.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/db', () => ({ getDb: vi.fn() }));
vi.mock('@/lib/queues', () => ({ getAllQueueStatuses: vi.fn() }));

import { GET as getJobs } from '@/app/api/v1/system/jobs/route';
import { GET as getVersion } from '@/app/api/v1/system/version/route';
import { getAllQueueStatuses } from '@/lib/queues';

import { buildRequest, FAKE_SESSION, readJson, setSession } from '@/__tests__/helpers';

const queueStatuses = vi.mocked(getAllQueueStatuses);

const ORIGINAL_BOOTED_AT = process.env['BOOTED_AT'];
const ORIGINAL_GIT_SHA = process.env['GIT_SHA'];
const ORIGINAL_PKG_VERSION = process.env['npm_package_version'];

beforeAll(async () => {
  // No DB needed for these routes; just ensure session helper has a target.
  await setSession(FAKE_SESSION);
});

beforeEach(async () => {
  await setSession(FAKE_SESSION);
  queueStatuses.mockReset();
});

afterEach(() => {
  // Restore originals so the env stays clean for sibling tests.
  if (ORIGINAL_BOOTED_AT === undefined) delete process.env['BOOTED_AT'];
  else process.env['BOOTED_AT'] = ORIGINAL_BOOTED_AT;
  if (ORIGINAL_GIT_SHA === undefined) delete process.env['GIT_SHA'];
  else process.env['GIT_SHA'] = ORIGINAL_GIT_SHA;
  if (ORIGINAL_PKG_VERSION === undefined) delete process.env['npm_package_version'];
  else process.env['npm_package_version'] = ORIGINAL_PKG_VERSION;
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe('GET /api/v1/system/version', () => {
  it('returns 401 without a session', async () => {
    await setSession(null);
    const res = await getVersion(await buildRequest('http://localhost/api/v1/system/version'));
    expect(res.status).toBe(401);
  });

  it('returns version + node version + booted at when admin is logged in', async () => {
    process.env['npm_package_version'] = '1.2.3';
    process.env['GIT_SHA'] = 'deadbeef';
    process.env['BOOTED_AT'] = '2026-05-19T01:00:00Z';

    const res = await getVersion(await buildRequest('http://localhost/api/v1/system/version'));
    expect(res.status).toBe(200);
    const body = await readJson<{
      data: {
        version: string;
        gitSha: string | null;
        nodeVersion: string;
        startedAt: string | null;
      };
    }>(res);
    expect(body.data.version).toBe('1.2.3');
    expect(body.data.gitSha).toBe('deadbeef');
    expect(body.data.nodeVersion).toBe(process.version);
    expect(body.data.startedAt).toBe('2026-05-19T01:00:00Z');
  });

  it('falls back to 0.0.0 / null when env vars are not set', async () => {
    delete process.env['npm_package_version'];
    delete process.env['GIT_SHA'];
    delete process.env['BOOTED_AT'];

    const res = await getVersion(await buildRequest('http://localhost/api/v1/system/version'));
    expect(res.status).toBe(200);
    const body = await readJson<{
      data: { version: string; gitSha: string | null; startedAt: string | null };
    }>(res);
    expect(body.data.version).toBe('0.0.0');
    expect(body.data.gitSha).toBeNull();
    expect(body.data.startedAt).toBeNull();
  });
});

describe('GET /api/v1/system/jobs', () => {
  it('returns 401 without a session', async () => {
    await setSession(null);
    const res = await getJobs(await buildRequest('http://localhost/api/v1/system/jobs'));
    expect(res.status).toBe(401);
    expect(queueStatuses).not.toHaveBeenCalled();
  });

  it('returns the queue snapshot array on success', async () => {
    queueStatuses.mockResolvedValueOnce([
      { name: 'uptime-check', waiting: 1, active: 0, delayed: 0, completed: 5, failed: 0 },
      { name: 'alert-fire', waiting: 0, active: 1, delayed: 0, completed: 12, failed: 2 },
    ]);

    const res = await getJobs(await buildRequest('http://localhost/api/v1/system/jobs'));
    expect(res.status).toBe(200);
    const body = await readJson<{ data: Array<{ name: string; waiting: number }> }>(res);
    expect(body.data.map((q) => q.name)).toEqual(['uptime-check', 'alert-fire']);
    expect(body.data[0]?.waiting).toBe(1);
    expect(queueStatuses).toHaveBeenCalledTimes(1);
  });

  it('surfaces per-queue errors without sinking the whole response', async () => {
    queueStatuses.mockResolvedValueOnce([
      {
        name: 'uptime-check',
        waiting: 0,
        active: 0,
        delayed: 0,
        completed: 0,
        failed: 0,
        error: 'redis: connection refused',
      },
    ]);

    const res = await getJobs(await buildRequest('http://localhost/api/v1/system/jobs'));
    expect(res.status).toBe(200);
    const body = await readJson<{
      data: Array<{ name: string; error?: string }>;
    }>(res);
    expect(body.data[0]?.error).toMatch(/connection refused/);
  });
});
