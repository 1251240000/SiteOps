/**
 * Tests for `checkLoginRateLimit` / `checkApiKeyRateLimit` (T31).
 *
 * Strategy: mock `@/lib/redis` with a hand-written stub so we can drive
 * happy / throwing behaviour deterministically. The Redis happy path is
 * already exercised end-to-end by the wrapper tests in
 * `with-api-rate-limit.test.ts`; here we lock down:
 *
 *   1. A working Redis path NEVER touches the local fallback.
 *   2. A Redis throw cleanly falls through to `localHit`, returning a
 *      sensible `{ allowed, count, retryAfterSec }` shape.
 *   3. Local fallback eventually flips `allowed=false` after `limit + 1`
 *      hits, and the local bucket is independent across keys.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/redis', () => ({ getRedis: vi.fn() }));

import { __resetLocalWindowForTests } from '@/lib/local-window';
import { checkApiKeyRateLimit, checkLoginRateLimit } from '@/lib/rate-limit';
import { getRedis } from '@/lib/redis';

type RedisStub = {
  status: 'ready' | 'wait' | 'end';
  connect: ReturnType<typeof vi.fn>;
  incr: ReturnType<typeof vi.fn>;
  expire: ReturnType<typeof vi.fn>;
  ttl: ReturnType<typeof vi.fn>;
};

function happyRedis(): RedisStub {
  return {
    status: 'ready',
    connect: vi.fn().mockResolvedValue(undefined),
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    ttl: vi.fn().mockResolvedValue(60),
  };
}

function brokenRedis(message = 'redis: connection refused'): RedisStub {
  const err = new Error(message);
  return {
    status: 'end',
    connect: vi.fn().mockRejectedValue(err),
    incr: vi.fn().mockRejectedValue(err),
    expire: vi.fn().mockRejectedValue(err),
    ttl: vi.fn().mockRejectedValue(err),
  };
}

function setRedis(stub: RedisStub): void {
  vi.mocked(getRedis).mockReturnValue(stub as unknown as ReturnType<typeof getRedis>);
}

beforeEach(() => {
  __resetLocalWindowForTests();
  vi.mocked(getRedis).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('checkApiKeyRateLimit (Redis happy path)', () => {
  it('returns allowed:true and never touches the local fallback when Redis is healthy', async () => {
    const redis = happyRedis();
    redis.incr.mockResolvedValue(1);
    setRedis(redis);

    const res = await checkApiKeyRateLimit({ id: 'key-1', rateLimitPerMin: null });
    expect(res).toMatchObject({ allowed: true, count: 1, retryAfterSec: 60 });
    expect(redis.incr).toHaveBeenCalledOnce();
    expect(redis.incr).toHaveBeenCalledWith('apikey:rl:key-1');
    expect(redis.expire).toHaveBeenCalledWith('apikey:rl:key-1', 60);
  });

  it('flips allowed:false when the Redis count exceeds the limit (default 600)', async () => {
    const redis = happyRedis();
    redis.incr.mockResolvedValue(601);
    redis.ttl.mockResolvedValue(42);
    setRedis(redis);

    const res = await checkApiKeyRateLimit({ id: 'hot-key', rateLimitPerMin: null });
    expect(res).toMatchObject({ allowed: false, count: 601, retryAfterSec: 42, limit: 600 });
  });

  it('honours the per-key rate_limit_per_min override (T38)', async () => {
    const redis = happyRedis();
    // 61st call (count = 61) against a budget of 60 should flip allowed=false.
    redis.incr.mockResolvedValue(61);
    redis.ttl.mockResolvedValue(17);
    setRedis(redis);

    const res = await checkApiKeyRateLimit({ id: 'tight-key', rateLimitPerMin: 60 });
    expect(res).toMatchObject({ allowed: false, count: 61, limit: 60, retryAfterSec: 17 });
  });

  it('falls back to the env default when rateLimitPerMin is null', async () => {
    const redis = happyRedis();
    redis.incr.mockResolvedValue(5);
    setRedis(redis);

    const res = await checkApiKeyRateLimit({ id: 'default-key', rateLimitPerMin: null });
    // 600 is the env default in the vitest setup.
    expect(res.limit).toBe(600);
  });
});

describe('checkApiKeyRateLimit (Redis fail → local fallback)', () => {
  it('falls back to the local LRU window and flips allowed:false after limit+1 hits', async () => {
    setRedis(brokenRedis());

    let last: Awaited<ReturnType<typeof checkApiKeyRateLimit>> | undefined;
    for (let i = 0; i < 600; i++) {
      last = await checkApiKeyRateLimit({ id: 'flood-key', rateLimitPerMin: null });
      expect(last.allowed).toBe(true);
      expect(last.count).toBe(i + 1);
    }
    // 601st request should be denied by the local bucket.
    last = await checkApiKeyRateLimit({ id: 'flood-key', rateLimitPerMin: null });
    expect(last.allowed).toBe(false);
    expect(last.count).toBe(601);
    expect(last.retryAfterSec).toBeGreaterThanOrEqual(1);
  });

  it('keeps local-fallback buckets independent across keys', async () => {
    setRedis(brokenRedis());
    const a = await checkApiKeyRateLimit({ id: 'a', rateLimitPerMin: null });
    const b = await checkApiKeyRateLimit({ id: 'b', rateLimitPerMin: null });
    expect(a.count).toBe(1);
    expect(b.count).toBe(1);
  });

  it('local fallback bucket resets after the 60s window elapses', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    setRedis(brokenRedis());

    const first = await checkApiKeyRateLimit({ id: 'reset-key', rateLimitPerMin: null });
    expect(first.count).toBe(1);

    // Advance past the window.
    vi.setSystemTime(new Date(Date.now() + 61_000));
    const after = await checkApiKeyRateLimit({ id: 'reset-key', rateLimitPerMin: null });
    expect(after.count).toBe(1);
    expect(after.allowed).toBe(true);
  });

  it('local fallback also honours the per-key override', async () => {
    setRedis(brokenRedis());
    // 60-call budget: first 60 allowed, 61st denied.
    let last: Awaited<ReturnType<typeof checkApiKeyRateLimit>> | undefined;
    for (let i = 0; i < 60; i++) {
      last = await checkApiKeyRateLimit({ id: 'tight-fallback', rateLimitPerMin: 60 });
      expect(last.allowed).toBe(true);
    }
    last = await checkApiKeyRateLimit({ id: 'tight-fallback', rateLimitPerMin: 60 });
    expect(last.allowed).toBe(false);
    expect(last.limit).toBe(60);
  });
});

describe('checkLoginRateLimit', () => {
  it('uses the configured login limit (default 5) on the local fallback path', async () => {
    setRedis(brokenRedis());
    const r1 = await checkLoginRateLimit('1.2.3.4');
    const r2 = await checkLoginRateLimit('1.2.3.4');
    const r3 = await checkLoginRateLimit('1.2.3.4');
    const r4 = await checkLoginRateLimit('1.2.3.4');
    const r5 = await checkLoginRateLimit('1.2.3.4');
    const r6 = await checkLoginRateLimit('1.2.3.4');
    expect([r1, r2, r3, r4, r5].every((r) => r.allowed)).toBe(true);
    expect(r6.allowed).toBe(false);
    expect(r6.count).toBe(6);
    expect(r6.limit).toBe(5);
  });

  it('falls through to the unknown-IP key when the caller passes empty string', async () => {
    setRedis(brokenRedis());
    const res = await checkLoginRateLimit('');
    expect(res.allowed).toBe(true);
    expect(res.count).toBe(1);
  });
});
