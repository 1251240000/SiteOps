/**
 * Tests for `getBadSigBucket()` (T31).
 *
 * The Redis happy path mirrors what the webhook routes already cover via
 * their handler tests; here we lock down the new fallback semantics:
 *
 *   1. A working Redis goes through the INCR/EXPIRE path verbatim.
 *   2. A throwing Redis transparently falls back to `localHit`, with the
 *      `over` flag flipping after `cap+1` deliveries.
 *   3. Different keys (different signing-failure source IPs / providers)
 *      keep independent local buckets.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/redis', () => ({ getRedis: vi.fn() }));

import { __resetBadSigBucketForTests, getBadSigBucket } from '@/lib/bad-sig-bucket';
import { __resetLocalWindowForTests } from '@/lib/local-window';
import { getRedis } from '@/lib/redis';

type RedisStub = {
  status: 'ready' | 'wait' | 'end';
  connect: ReturnType<typeof vi.fn>;
  incr: ReturnType<typeof vi.fn>;
  expire: ReturnType<typeof vi.fn>;
};

function happyRedis(): RedisStub {
  return {
    status: 'ready',
    connect: vi.fn().mockResolvedValue(undefined),
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
  };
}

function brokenRedis(message = 'redis: read ETIMEDOUT'): RedisStub {
  const err = new Error(message);
  return {
    status: 'end',
    connect: vi.fn().mockRejectedValue(err),
    incr: vi.fn().mockRejectedValue(err),
    expire: vi.fn().mockRejectedValue(err),
  };
}

function setRedis(stub: RedisStub): void {
  vi.mocked(getRedis).mockReturnValue(stub as unknown as ReturnType<typeof getRedis>);
}

beforeEach(() => {
  __resetLocalWindowForTests();
  __resetBadSigBucketForTests();
  vi.mocked(getRedis).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('badSigBucket.hit (Redis happy path)', () => {
  it('arms TTL on first hit and reports over:false until count exceeds cap', async () => {
    const redis = happyRedis();
    redis.incr
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(50)
      .mockResolvedValueOnce(51);
    setRedis(redis);

    const bucket = getBadSigBucket();
    const r1 = await bucket.hit('cf:1.2.3.4', 300, 50);
    expect(r1).toEqual({ count: 1, over: false });
    expect(redis.expire).toHaveBeenCalledWith('webhook:badsig:cf:1.2.3.4', 300);

    const r2 = await bucket.hit('cf:1.2.3.4', 300, 50);
    expect(r2).toEqual({ count: 2, over: false });
    // Subsequent hits don't re-arm the TTL.
    expect(redis.expire).toHaveBeenCalledTimes(1);

    const r3 = await bucket.hit('cf:1.2.3.4', 300, 50);
    expect(r3.over).toBe(false);
    const r4 = await bucket.hit('cf:1.2.3.4', 300, 50);
    expect(r4.over).toBe(true);
  });
});

describe('badSigBucket.hit (Redis fail → local fallback)', () => {
  it('flips over=true once local count exceeds cap', async () => {
    setRedis(brokenRedis());
    const bucket = getBadSigBucket();

    let res: Awaited<ReturnType<typeof bucket.hit>> | undefined;
    for (let i = 0; i < 50; i++) {
      res = await bucket.hit('cf:9.9.9.9', 300, 50);
      expect(res.over).toBe(false);
      expect(res.count).toBe(i + 1);
    }
    // 51st delivery should trip the cap on the local bucket.
    res = await bucket.hit('cf:9.9.9.9', 300, 50);
    expect(res.over).toBe(true);
    expect(res.count).toBe(51);
  });

  it('keeps independent buckets per key during a Redis outage', async () => {
    setRedis(brokenRedis());
    const bucket = getBadSigBucket();
    const a = await bucket.hit('cf:a', 300, 50);
    const b = await bucket.hit('cf:b', 300, 50);
    expect(a).toEqual({ count: 1, over: false });
    expect(b).toEqual({ count: 1, over: false });
  });

  it('local fallback bucket resets after the configured ttlSec', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    setRedis(brokenRedis());
    const bucket = getBadSigBucket();

    await bucket.hit('cf:reset', 300, 50);
    await bucket.hit('cf:reset', 300, 50);

    vi.setSystemTime(new Date(Date.now() + 301_000));
    const after = await bucket.hit('cf:reset', 300, 50);
    expect(after.count).toBe(1);
  });
});
