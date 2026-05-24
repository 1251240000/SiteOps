/**
 * Verifies the per-API-key sliding window applied by `withApiKey` and the
 * Bearer branch of `withAuth`.
 *
 * Strategy: mock `@/lib/rate-limit` to drive the verdict (allowed / denied)
 * and assert what the wrapper does with it. We don't exercise Redis here —
 * the helper itself has its own test path; the wrappers just have to:
 *
 *   1. forward the apiKey id to the limiter
 *   2. return 429 + `Retry-After` + canonical error body when denied
 *   3. stamp `X-RateLimit-{Limit,Remaining,Reset}` on success
 *   4. NOT call the limiter for session-auth callers
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/db', () => ({ getDb: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({
  checkApiKeyRateLimit: vi.fn(),
}));

import { apiKeys } from '@siteops/db';
import { generateApiKey } from '@siteops/shared';

import {
  bindDbMock,
  buildRequest,
  FAKE_SESSION,
  readJson,
  resetDb,
  setSession,
  setupTestDb,
} from '@/__tests__/helpers';
import { checkApiKeyRateLimit } from '@/lib/rate-limit';
import { ok, withApi, withApiKey, withAuth } from '@/lib/with-api';

const checkRl = checkApiKeyRateLimit as unknown as ReturnType<typeof vi.fn>;

async function seedApiKey(scopes: string[] = ['errors:write']): Promise<string> {
  const handle = await setupTestDb();
  const generated = await generateApiKey();
  await handle.db.insert(apiKeys).values({
    name: 'rl-test-agent',
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
  await setSession(null);
  checkRl.mockReset();
});

afterEach(() => {
  checkRl.mockReset();
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe('withApiKey rate limiting', () => {
  it('returns 429 + Retry-After when the limiter denies', async () => {
    const plaintext = await seedApiKey();
    checkRl.mockResolvedValueOnce({ allowed: false, count: 601, limit: 600, retryAfterSec: 42 });

    const handler = withApiKey(async () => ok({ ok: true }));
    const res = await handler(
      await buildRequest('http://localhost/x', {
        headers: { authorization: `Bearer ${plaintext}` },
      }),
    );

    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('42');
    expect(res.headers.get('x-ratelimit-limit')).toBe('600');
    expect(res.headers.get('x-ratelimit-remaining')).toBe('0');
    const body = await readJson<{ error: { code: string; details?: { retryAfterSec: number } } }>(
      res,
    );
    expect(body.error.code).toBe('rate_limited');
    expect(body.error.details?.retryAfterSec).toBe(42);
  });

  it('passes through and stamps X-RateLimit headers when allowed', async () => {
    const plaintext = await seedApiKey();
    checkRl.mockResolvedValueOnce({ allowed: true, count: 5, limit: 600, retryAfterSec: 60 });

    const handler = withApiKey(async () => ok({ ok: true }));
    const res = await handler(
      await buildRequest('http://localhost/x', {
        headers: { authorization: `Bearer ${plaintext}` },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('x-ratelimit-limit')).toBe('600');
    expect(res.headers.get('x-ratelimit-remaining')).toBe('595');
    expect(res.headers.get('x-ratelimit-reset')).toBe('60');
  });

  it('keys the limiter on api_keys.id (not plaintext or IP) and forwards rateLimitPerMin', async () => {
    const plaintext = await seedApiKey();
    checkRl.mockResolvedValueOnce({ allowed: true, count: 1, limit: 600, retryAfterSec: 60 });

    const handler = withApiKey(async () => ok({ ok: true }));
    await handler(
      await buildRequest('http://localhost/x', {
        headers: { authorization: `Bearer ${plaintext}` },
      }),
    );
    expect(checkRl).toHaveBeenCalledTimes(1);
    const arg = checkRl.mock.calls[0]?.[0] as { id: string; rateLimitPerMin: number | null };
    expect(arg.id).toMatch(/^[0-9a-f-]{36}$/);
    // Seeded row has no override → forwarded as null.
    expect(arg.rateLimitPerMin).toBeNull();
  });

  it('does NOT consult the limiter when the key is invalid (still 401)', async () => {
    const handler = withApiKey(async () => ok({ ok: true }));
    const res = await handler(
      await buildRequest('http://localhost/x', {
        headers: { authorization: 'Bearer not-a-real-key' },
      }),
    );
    expect(res.status).toBe(401);
    expect(checkRl).not.toHaveBeenCalled();
  });
});

describe('withAuth rate limiting', () => {
  it('does NOT consult the limiter for a session-authed request', async () => {
    await setSession(FAKE_SESSION);
    const handler = withAuth(async () => ok({ ok: true }));
    const res = await handler(await buildRequest('http://localhost/x'));
    expect(res.status).toBe(200);
    expect(checkRl).not.toHaveBeenCalled();
    expect(res.headers.get('x-ratelimit-limit')).toBeNull();
  });

  it('applies the limiter when the caller falls back to a Bearer key', async () => {
    const plaintext = await seedApiKey();
    checkRl.mockResolvedValueOnce({ allowed: false, count: 601, limit: 600, retryAfterSec: 17 });

    const handler = withAuth(async () => ok({ ok: true }));
    const res = await handler(
      await buildRequest('http://localhost/x', {
        headers: { authorization: `Bearer ${plaintext}` },
      }),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('17');
  });
});

describe('withApi (session only) is unaffected', () => {
  it('never calls the API-key limiter', async () => {
    await setSession(FAKE_SESSION);
    const handler = withApi(async () => ok({ ok: true }));
    const res = await handler(await buildRequest('http://localhost/x'));
    expect(res.status).toBe(200);
    expect(checkRl).not.toHaveBeenCalled();
  });
});
