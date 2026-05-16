/**
 * API route-handler tests for `/api/v1/sites`.
 *
 * These exercise the wiring around `withAuth` + Zod validation + the
 * `siteService` call, using a real PGlite database (so the service path
 * is genuinely run, not mocked). Auth and the DB handle factory are
 * mocked at the module boundary so the handlers don't need NextAuth or
 * a real Postgres at test time.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/db', () => ({ getDb: vi.fn() }));

import { GET, POST } from '@/app/api/v1/sites/route';

import {
  bindDbMock,
  buildRequest,
  FAKE_SESSION,
  readJson,
  resetDb,
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

afterAll(async () => {
  vi.restoreAllMocks();
});

describe('POST /api/v1/sites', () => {
  it('returns 401 when there is no session and no API key', async () => {
    await setSession(null);
    const req = await buildRequest('http://localhost/api/v1/sites', {
      method: 'POST',
      body: { name: 'X', primaryUrl: 'https://x.example.com', siteType: 'tool', status: 'active' },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = await readJson<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unauthorized');
  });

  it('returns 400 when the body is missing required fields', async () => {
    const req = await buildRequest('http://localhost/api/v1/sites', {
      method: 'POST',
      body: { name: '' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await readJson<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('validation_failed');
  });

  it('returns 400 on invalid JSON', async () => {
    const { NextRequest } = await import('next/server');
    const broken = new Request('http://localhost/api/v1/sites', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not-json',
    });
    const res = await POST(new NextRequest(broken));
    expect(res.status).toBe(400);
    const body = await readJson<{ error: { code: string; message: string } }>(res);
    expect(body.error.code).toBe('validation_failed');
  });

  it('creates a site and returns 201 with derived slug + primary domain', async () => {
    const req = await buildRequest('http://localhost/api/v1/sites', {
      method: 'POST',
      body: {
        name: 'Docs Example',
        primaryUrl: 'https://docs.example.com',
        siteType: 'content',
        status: 'active',
        tags: [],
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await readJson<{ data: { id: string; slug: string; healthScore: number } }>(res);
    expect(body.data.slug).toBe('docs-example');
    expect(body.data.healthScore).toBe(100);
    expect(body.data.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('GET /api/v1/sites', () => {
  it('returns 401 when unauthenticated', async () => {
    await setSession(null);
    const req = await buildRequest('http://localhost/api/v1/sites');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('returns 400 when limit exceeds 100', async () => {
    const req = await buildRequest('http://localhost/api/v1/sites?limit=999');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('returns the sites the user just created (paginated envelope)', async () => {
    // Seed via the POST handler to keep this test integration-style.
    const create = await buildRequest('http://localhost/api/v1/sites', {
      method: 'POST',
      body: {
        name: 'Listed',
        primaryUrl: 'https://listed.example.com',
        siteType: 'tool',
        status: 'active',
        tags: [],
      },
    });
    expect((await POST(create)).status).toBe(201);

    const list = await buildRequest('http://localhost/api/v1/sites');
    const res = await GET(list);
    expect(res.status).toBe(200);
    const body = await readJson<{
      data: Array<{ slug: string }>;
      meta: { total: number; page: number; limit: number };
    }>(res);
    expect(body.meta.total).toBe(1);
    expect(body.data[0]?.slug).toBe('listed');
  });
});
