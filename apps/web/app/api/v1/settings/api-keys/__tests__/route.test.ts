/**
 * Route-handler tests for `/api/v1/settings/api-keys/*`.
 *
 * Covers:
 *   - 401 without an admin session
 *   - 201 + plaintext on creation
 *   - validation failures on the create body
 *   - DELETE → idempotent revoke
 *   - GET state filter (active / revoked)
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/db', () => ({ getDb: vi.fn() }));

import type { ApiKeyView } from '@siteops/db';

import { GET as listApiKeys, POST as createApiKey } from '@/app/api/v1/settings/api-keys/route';
import { DELETE as revokeApiKey } from '@/app/api/v1/settings/api-keys/[id]/route';

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

describe('POST /api/v1/settings/api-keys', () => {
  it('returns 401 without a session', async () => {
    await setSession(null);
    const res = await createApiKey(
      await buildRequest('http://localhost/api/v1/settings/api-keys', {
        method: 'POST',
        body: { name: 'x', scopes: ['errors:write'] },
      }),
    );
    expect(res.status).toBe(401);
  });

  it('creates a key and returns the plaintext exactly once', async () => {
    const res = await createApiKey(
      await buildRequest('http://localhost/api/v1/settings/api-keys', {
        method: 'POST',
        body: { name: 'reporting-agent', scopes: ['errors:write', 'tasks:read'] },
      }),
    );
    expect(res.status).toBe(201);
    const body = await readJson<{
      data: { apiKey: ApiKeyView; plaintext: string };
    }>(res);
    expect(body.data.plaintext).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(body.data.apiKey).not.toHaveProperty('keyHash');
    expect(body.data.apiKey.scopes.sort()).toEqual(['errors:write', 'tasks:read']);
  });

  it('400s on a validation failure (empty scopes)', async () => {
    const res = await createApiKey(
      await buildRequest('http://localhost/api/v1/settings/api-keys', {
        method: 'POST',
        body: { name: 'broken', scopes: [] },
      }),
    );
    expect(res.status).toBe(400);
  });

  it('400s on wildcard mixed with explicit scopes', async () => {
    const res = await createApiKey(
      await buildRequest('http://localhost/api/v1/settings/api-keys', {
        method: 'POST',
        body: { name: 'mixed', scopes: ['*', 'errors:write'] },
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/settings/api-keys', () => {
  it('lists active keys and excludes revoked when state=active', async () => {
    // Seed one active + one revoked through the create / delete routes.
    const aRes = await createApiKey(
      await buildRequest('http://localhost/api/v1/settings/api-keys', {
        method: 'POST',
        body: { name: 'live', scopes: ['errors:write'] },
      }),
    );
    const a = await readJson<{ data: { apiKey: { id: string } } }>(aRes);
    const bRes = await createApiKey(
      await buildRequest('http://localhost/api/v1/settings/api-keys', {
        method: 'POST',
        body: { name: 'dead', scopes: ['errors:write'] },
      }),
    );
    const b = await readJson<{ data: { apiKey: { id: string } } }>(bRes);
    await revokeApiKey(
      await buildRequest(`http://localhost/api/v1/settings/api-keys/${b.data.apiKey.id}`, {
        method: 'DELETE',
      }),
      routeContext({ id: b.data.apiKey.id }),
    );

    const listRes = await listApiKeys(
      await buildRequest('http://localhost/api/v1/settings/api-keys?state=active'),
    );
    expect(listRes.status).toBe(200);
    const body = await readJson<{ data: ApiKeyView[] }>(listRes);
    expect(body.data.map((r) => r.id)).toEqual([a.data.apiKey.id]);
    // Sanity: never leak key_hash.
    for (const item of body.data) {
      expect(item).not.toHaveProperty('keyHash');
    }
  });
});

describe('DELETE /api/v1/settings/api-keys/:id', () => {
  it('revokes a fresh key and is idempotent on a second call', async () => {
    const created = await createApiKey(
      await buildRequest('http://localhost/api/v1/settings/api-keys', {
        method: 'POST',
        body: { name: 'rev', scopes: ['errors:write'] },
      }),
    );
    const { data } = await readJson<{ data: { apiKey: { id: string } } }>(created);

    const first = await revokeApiKey(
      await buildRequest(`http://localhost/api/v1/settings/api-keys/${data.apiKey.id}`, {
        method: 'DELETE',
      }),
      routeContext({ id: data.apiKey.id }),
    );
    expect(first.status).toBe(200);
    const firstBody = await readJson<{ data: ApiKeyView }>(first);
    expect(firstBody.data.revokedAt).not.toBeNull();

    const second = await revokeApiKey(
      await buildRequest(`http://localhost/api/v1/settings/api-keys/${data.apiKey.id}`, {
        method: 'DELETE',
      }),
      routeContext({ id: data.apiKey.id }),
    );
    expect(second.status).toBe(200);
    const secondBody = await readJson<{ data: ApiKeyView }>(second);
    // revoked_at unchanged across calls.
    expect(secondBody.data.revokedAt).toEqual(firstBody.data.revokedAt);
  });

  it('returns 404 for an unknown id', async () => {
    const res = await revokeApiKey(
      await buildRequest(
        'http://localhost/api/v1/settings/api-keys/00000000-0000-4000-8000-000000000000',
        { method: 'DELETE' },
      ),
      routeContext({ id: '00000000-0000-4000-8000-000000000000' }),
    );
    expect(res.status).toBe(404);
  });
});
