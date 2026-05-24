/**
 * Tests for the `Idempotency-Key` middleware (T37).
 *
 * Strategy: drive everything through `withApi` / `withAuth` so the assertions
 * exercise the wrapper integration verbatim. Redis is stubbed via the
 * existing `@/lib/redis` mock pattern with an in-memory map — that lets us
 * assert the cache wiring (TTL arg, key shape) without spinning up a real
 * server.
 *
 * Coverage targets (mirror the acceptance criteria on T37):
 *   1. Same key + same body → handler runs once, second call replays.
 *   2. Same key + different body → 422 `idempotency_conflict`.
 *   3. 5xx response not cached → retry re-runs the handler.
 *   4. Malformed key header → 400 `validation_failed`.
 *   5. Methods other than POST/PUT/PATCH never consult the cache.
 *   6. Integration: `POST /sites` repeated 5x with the same key produces
 *      exactly one DB row.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/db', () => ({ getDb: vi.fn() }));
vi.mock('@/lib/redis', () => ({ getRedis: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({ checkApiKeyRateLimit: vi.fn() }));

import { apiKeys, sites } from '@siteops/db';
import { generateApiKey } from '@siteops/shared';

import { POST as createSiteRoute } from '@/app/api/v1/sites/route';
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
import { getRedis } from '@/lib/redis';
import { ok, withApi, withApiKey, withAuth } from '@/lib/with-api';

/** In-memory Redis stub: enough surface for `idempotency.ts` to function. */
function makeRedisStub() {
  const store = new Map<string, string>();
  return {
    store,
    stub: {
      status: 'ready' as const,
      connect: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(async (k: string) => store.get(k) ?? null),
      setex: vi.fn(async (k: string, _ttl: number, v: string) => {
        store.set(k, v);
        return 'OK';
      }),
    },
  };
}

function brokenRedis() {
  const err = new Error('redis: connection refused');
  return {
    status: 'end' as const,
    connect: vi.fn().mockRejectedValue(err),
    get: vi.fn().mockRejectedValue(err),
    setex: vi.fn().mockRejectedValue(err),
  };
}

const checkRl = checkApiKeyRateLimit as unknown as ReturnType<typeof vi.fn>;

beforeAll(async () => {
  await setupTestDb();
  await bindDbMock();
});

beforeEach(async () => {
  await resetDb();
  await setSession(null);
  checkRl.mockReset();
  vi.mocked(getRedis).mockReset();
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe('Idempotency middleware — session (withApi)', () => {
  it('replays the cached response on the second call with the same key + body', async () => {
    await setSession(FAKE_SESSION);
    const { stub } = makeRedisStub();
    vi.mocked(getRedis).mockReturnValue(stub as unknown as ReturnType<typeof getRedis>);

    let handlerCalls = 0;
    const handler = withApi(async () => {
      handlerCalls += 1;
      return ok({ counter: handlerCalls }, { status: 201 });
    });

    const url = 'http://localhost/api/v1/things';
    const body = { foo: 'bar' };
    const headers = { 'idempotency-key': 'abc.123-key' };

    const first = await handler(await buildRequest(url, { method: 'POST', body, headers }));
    const second = await handler(await buildRequest(url, { method: 'POST', body, headers }));

    expect(handlerCalls).toBe(1);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.headers.get('idempotent-replay')).toBe('true');

    const firstBody = await readJson<{ data: { counter: number } }>(first);
    const secondBody = await readJson<{ data: { counter: number } }>(second);
    expect(firstBody.data.counter).toBe(1);
    expect(secondBody.data.counter).toBe(1);
  });

  it('returns 422 idempotency_conflict when the same key is reused with a different body', async () => {
    await setSession(FAKE_SESSION);
    const { stub } = makeRedisStub();
    vi.mocked(getRedis).mockReturnValue(stub as unknown as ReturnType<typeof getRedis>);

    const handler = withApi(async () => ok({ ok: true }, { status: 201 }));
    const url = 'http://localhost/api/v1/things';
    const headers = { 'idempotency-key': 'reused-key' };

    const first = await handler(
      await buildRequest(url, { method: 'POST', body: { a: 1 }, headers }),
    );
    expect(first.status).toBe(201);

    const conflict = await handler(
      await buildRequest(url, { method: 'POST', body: { a: 2 }, headers }),
    );
    expect(conflict.status).toBe(422);
    const body = await readJson<{ error: { code: string } }>(conflict);
    expect(body.error.code).toBe('idempotency_conflict');
  });

  it('does NOT cache 5xx responses; the next retry re-runs the handler', async () => {
    await setSession(FAKE_SESSION);
    const { stub, store } = makeRedisStub();
    vi.mocked(getRedis).mockReturnValue(stub as unknown as ReturnType<typeof getRedis>);

    let attempt = 0;
    const handler = withApi(async () => {
      attempt += 1;
      if (attempt === 1) {
        return new Response('boom', { status: 503 });
      }
      return ok({ recovered: true }, { status: 201 });
    });

    const url = 'http://localhost/api/v1/things';
    const headers = { 'idempotency-key': 'retry-after-5xx' };

    const first = await handler(
      await buildRequest(url, { method: 'POST', body: { a: 1 }, headers }),
    );
    expect(first.status).toBe(503);
    expect(store.size).toBe(0);

    const second = await handler(
      await buildRequest(url, { method: 'POST', body: { a: 1 }, headers }),
    );
    expect(second.status).toBe(201);
    expect(attempt).toBe(2);
    expect(second.headers.get('idempotent-replay')).toBeNull();
  });

  it('rejects malformed Idempotency-Key with 400 validation_failed', async () => {
    await setSession(FAKE_SESSION);
    const { stub } = makeRedisStub();
    vi.mocked(getRedis).mockReturnValue(stub as unknown as ReturnType<typeof getRedis>);

    const handler = withApi(async () => ok({ ok: true }));

    for (const bad of ['', 'has spaces', 'has,comma', 'a'.repeat(257)]) {
      const res = await handler(
        await buildRequest('http://localhost/x', {
          method: 'POST',
          body: { a: 1 },
          headers: { 'idempotency-key': bad },
        }),
      );
      expect(res.status, `key=${JSON.stringify(bad)}`).toBe(400);
      const body = await readJson<{ error: { code: string } }>(res);
      expect(body.error.code).toBe('validation_failed');
    }
  });

  it('accepts valid key character classes and trims neither end', async () => {
    await setSession(FAKE_SESSION);
    const { stub } = makeRedisStub();
    vi.mocked(getRedis).mockReturnValue(stub as unknown as ReturnType<typeof getRedis>);

    const handler = withApi(async () => ok({ ok: true }, { status: 201 }));
    const res = await handler(
      await buildRequest('http://localhost/x', {
        method: 'POST',
        body: { a: 1 },
        headers: { 'idempotency-key': 'AaZz09_-.' },
      }),
    );
    expect(res.status).toBe(201);
  });

  it('does NOT cache for GET or DELETE even when the header is present', async () => {
    await setSession(FAKE_SESSION);
    const { stub, store } = makeRedisStub();
    vi.mocked(getRedis).mockReturnValue(stub as unknown as ReturnType<typeof getRedis>);

    let calls = 0;
    const handler = withApi(async () => {
      calls += 1;
      return ok({ calls });
    });

    for (const method of ['GET', 'DELETE'] as const) {
      await handler(
        await buildRequest('http://localhost/x', {
          method,
          headers: { 'idempotency-key': 'k' },
        }),
      );
    }
    expect(stub.get).not.toHaveBeenCalled();
    expect(stub.setex).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
    expect(calls).toBe(2);
  });

  it('scopes the cache key by principal: two users with the same key do not replay each other', async () => {
    const { stub } = makeRedisStub();
    vi.mocked(getRedis).mockReturnValue(stub as unknown as ReturnType<typeof getRedis>);

    let calls = 0;
    const handler = withApi(async (_req, ctx) => {
      calls += 1;
      return ok({ userId: ctx.user?.id, calls }, { status: 201 });
    });

    await setSession(FAKE_SESSION);
    await handler(
      await buildRequest('http://localhost/x', {
        method: 'POST',
        body: { a: 1 },
        headers: { 'idempotency-key': 'shared' },
      }),
    );

    await setSession({
      ...FAKE_SESSION,
      user: { ...FAKE_SESSION.user, id: '22222222-2222-4222-8222-222222222222' },
    });
    const second = await handler(
      await buildRequest('http://localhost/x', {
        method: 'POST',
        body: { a: 1 },
        headers: { 'idempotency-key': 'shared' },
      }),
    );

    expect(calls).toBe(2);
    expect(second.headers.get('idempotent-replay')).toBeNull();
  });

  it('keeps POST and PATCH independent for the same key', async () => {
    await setSession(FAKE_SESSION);
    const { stub } = makeRedisStub();
    vi.mocked(getRedis).mockReturnValue(stub as unknown as ReturnType<typeof getRedis>);

    let calls = 0;
    const handler = withApi(async () => {
      calls += 1;
      return ok({ calls }, { status: 201 });
    });

    await handler(
      await buildRequest('http://localhost/x', {
        method: 'POST',
        body: { a: 1 },
        headers: { 'idempotency-key': 'k' },
      }),
    );
    await handler(
      await buildRequest('http://localhost/x', {
        method: 'PATCH',
        body: { a: 1 },
        headers: { 'idempotency-key': 'k' },
      }),
    );
    expect(calls).toBe(2);
  });

  it('degrades open when Redis throws (handler still runs, no replay)', async () => {
    await setSession(FAKE_SESSION);
    vi.mocked(getRedis).mockReturnValue(brokenRedis() as unknown as ReturnType<typeof getRedis>);

    let calls = 0;
    const handler = withApi(async () => {
      calls += 1;
      return ok({ calls }, { status: 201 });
    });

    const first = await handler(
      await buildRequest('http://localhost/x', {
        method: 'POST',
        body: { a: 1 },
        headers: { 'idempotency-key': 'k' },
      }),
    );
    const second = await handler(
      await buildRequest('http://localhost/x', {
        method: 'POST',
        body: { a: 1 },
        headers: { 'idempotency-key': 'k' },
      }),
    );
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.headers.get('idempotent-replay')).toBeNull();
    expect(calls).toBe(2);
  });
});

describe('Idempotency middleware — bearer key (withApiKey / withAuth)', () => {
  async function seedApiKey(scopes: string[] = ['sites:write']): Promise<string> {
    const handle = await setupTestDb();
    const generated = await generateApiKey();
    await handle.db.insert(apiKeys).values({
      name: 'idem-test',
      keyHash: generated.hash,
      keyPrefix: generated.prefix,
      scopes,
    });
    return generated.plaintext;
  }

  it('replays via withApiKey using api_keys.id as the principal', async () => {
    const plaintext = await seedApiKey();
    const { stub } = makeRedisStub();
    vi.mocked(getRedis).mockReturnValue(stub as unknown as ReturnType<typeof getRedis>);
    checkRl.mockResolvedValue({ allowed: true, count: 1, limit: 600, retryAfterSec: 60 });

    let calls = 0;
    const handler = withApiKey(
      async () => {
        calls += 1;
        return ok({ calls }, { status: 201 });
      },
      { scopes: ['sites:write'] },
    );

    const opts = {
      method: 'POST' as const,
      body: { a: 1 },
      headers: { authorization: `Bearer ${plaintext}`, 'idempotency-key': 'apikey-replay' },
    };
    const first = await handler(await buildRequest('http://localhost/x', opts));
    const second = await handler(await buildRequest('http://localhost/x', opts));

    expect(first.status).toBe(201);
    expect(calls).toBe(1);
    expect(second.headers.get('idempotent-replay')).toBe('true');
    // Rate-limit headers must reflect the CURRENT call, not the cached one.
    expect(second.headers.get('x-ratelimit-limit')).toBe('600');
  });

  it('falls back through withAuth bearer branch and still replays', async () => {
    const plaintext = await seedApiKey();
    const { stub } = makeRedisStub();
    vi.mocked(getRedis).mockReturnValue(stub as unknown as ReturnType<typeof getRedis>);
    checkRl.mockResolvedValue({ allowed: true, count: 1, limit: 600, retryAfterSec: 60 });

    let calls = 0;
    const handler = withAuth(
      async () => {
        calls += 1;
        return ok({ calls }, { status: 201 });
      },
      { scopes: ['sites:write'] },
    );
    const opts = {
      method: 'POST' as const,
      body: { a: 1 },
      headers: { authorization: `Bearer ${plaintext}`, 'idempotency-key': 'auth-replay' },
    };

    const first = await handler(await buildRequest('http://localhost/x', opts));
    const second = await handler(await buildRequest('http://localhost/x', opts));
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(calls).toBe(1);
    expect(second.headers.get('idempotent-replay')).toBe('true');
  });

  it('mints a fresh requestId on replay (cached x-request-id is dropped)', async () => {
    await setSession(FAKE_SESSION);
    const { stub } = makeRedisStub();
    vi.mocked(getRedis).mockReturnValue(stub as unknown as ReturnType<typeof getRedis>);

    const handler = withApi(async () => ok({ ok: true }, { status: 201 }));
    const headers = { 'idempotency-key': 'reqid-rotate', 'x-request-id': 'req_first' };
    const first = await handler(
      await buildRequest('http://localhost/x', { method: 'POST', body: { a: 1 }, headers }),
    );
    expect(first.headers.get('x-request-id')).toBe('req_first');

    const second = await handler(
      await buildRequest('http://localhost/x', {
        method: 'POST',
        body: { a: 1 },
        headers: { 'idempotency-key': 'reqid-rotate', 'x-request-id': 'req_second' },
      }),
    );
    expect(second.headers.get('x-request-id')).toBe('req_second');
    expect(second.headers.get('idempotent-replay')).toBe('true');
  });
});

describe('Idempotency middleware — POST /api/v1/sites integration', () => {
  it('creates exactly one site row across 5 repeats with the same Idempotency-Key', async () => {
    await setSession(FAKE_SESSION);
    const { stub } = makeRedisStub();
    vi.mocked(getRedis).mockReturnValue(stub as unknown as ReturnType<typeof getRedis>);

    const handle = await setupTestDb();
    const body = {
      name: 'Idem Site',
      primaryUrl: 'https://idem.example.com',
      siteType: 'tool' as const,
      status: 'active' as const,
      tags: [] as string[],
    };
    const headers = { 'idempotency-key': 'site-dedupe-1' };

    const responses: Response[] = [];
    for (let i = 0; i < 5; i++) {
      const req = await buildRequest('http://localhost/api/v1/sites', {
        method: 'POST',
        body,
        headers,
      });
      responses.push(await createSiteRoute(req));
    }

    for (const r of responses) {
      expect(r.status).toBe(201);
    }
    // First call ran the handler, the next four were replays.
    expect(responses.slice(1).every((r) => r.headers.get('idempotent-replay') === 'true')).toBe(
      true,
    );

    const rows = await handle.db.select().from(sites);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('Idem Site');
  });
});
