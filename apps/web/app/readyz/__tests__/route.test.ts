/**
 * Route-handler tests for `GET /readyz` (T29).
 *
 * Verifies:
 *   - 200 + status:'ok' when both DB and Redis respond
 *   - 503 + db:'fail' when the DB ping rejects
 *   - 503 + redis:'fail' when the Redis ping rejects
 *   - 503 + db:'fail' when the DB ping hangs longer than 1 s (timeout)
 *
 * Both `@/lib/db` and `@/lib/redis` are mocked at module level so we can
 * cheaply simulate dependency failures without standing up Postgres/Redis.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ getDb: vi.fn() }));
vi.mock('@/lib/redis', () => ({ getRedis: vi.fn() }));

import { __resetReadyzStateForTests, GET } from '@/app/readyz/route';
import { getDb } from '@/lib/db';
import { getRedis } from '@/lib/redis';
import { readJson } from '@/__tests__/helpers';

type Checks = { db: 'ok' | 'fail'; redis: 'ok' | 'fail' };
type ReadyzBody = { status: 'ok' | 'degraded'; checks: Checks };

function setDb(execute: () => Promise<unknown>): void {
  vi.mocked(getDb).mockReturnValue({ execute } as unknown as ReturnType<typeof getDb>);
}

function setRedis(ping: () => Promise<unknown>): void {
  vi.mocked(getRedis).mockReturnValue({ ping } as unknown as ReturnType<typeof getRedis>);
}

beforeEach(() => {
  __resetReadyzStateForTests();
  setDb(() => Promise.resolve(undefined));
  setRedis(() => Promise.resolve('PONG'));
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe('GET /readyz', () => {
  it('returns 200 when DB and Redis both respond', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await readJson<ReadyzBody>(res);
    expect(body).toEqual({ status: 'ok', checks: { db: 'ok', redis: 'ok' } });
  });

  it('returns 503 with db:fail when the DB ping rejects', async () => {
    setDb(() => Promise.reject(new Error('connection refused')));
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await readJson<ReadyzBody>(res);
    expect(body).toEqual({ status: 'degraded', checks: { db: 'fail', redis: 'ok' } });
  });

  it('returns 503 with redis:fail when the Redis ping rejects', async () => {
    setRedis(() => Promise.reject(new Error('redis down')));
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await readJson<ReadyzBody>(res);
    expect(body).toEqual({ status: 'degraded', checks: { db: 'ok', redis: 'fail' } });
  });

  it('returns 503 with db:fail when the DB ping hangs past the 1 s timeout', async () => {
    vi.useFakeTimers();
    setDb(() => new Promise(() => {})); // never resolves
    const pending = GET();
    // Past the 1000ms cap inside withTimeout — long enough to flush both
    // the setTimeout and the cascading microtasks that resolve the response.
    await vi.advanceTimersByTimeAsync(1100);
    const res = await pending;
    expect(res.status).toBe(503);
    const body = await readJson<ReadyzBody>(res);
    expect(body.status).toBe('degraded');
    expect(body.checks.db).toBe('fail');
    expect(body.checks.redis).toBe('ok');
  });
});
