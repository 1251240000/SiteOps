/**
 * API route-handler tests for `/api/v1/revenue/sites/{id}/affiliate-entries`.
 *
 * Smoke-level coverage of the M4 manual-entry endpoint: we want to be sure
 * that the auth gate trips, validation works, and a successful POST shows
 * up in the GET list.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/db', () => ({ getDb: vi.fn() }));

import { POST as createSite } from '@/app/api/v1/sites/route';
import {
  GET as listEntries,
  POST as createEntry,
} from '@/app/api/v1/revenue/sites/[id]/affiliate-entries/route';

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

async function seedSite(): Promise<string> {
  const req = await buildRequest('http://localhost/api/v1/sites', {
    method: 'POST',
    body: {
      name: 'Affiliate Site',
      primaryUrl: 'https://aff.example.com',
      siteType: 'content',
      status: 'active',
      tags: [],
    },
  });
  const res = await createSite(req);
  expect(res.status).toBe(201);
  const body = await readJson<{ data: { id: string } }>(res);
  return body.data.id;
}

describe('POST /api/v1/revenue/sites/{id}/affiliate-entries', () => {
  it('returns 401 without a session', async () => {
    await setSession(null);
    const req = await buildRequest('http://localhost/api/v1/revenue/sites/x/affiliate-entries', {
      method: 'POST',
      body: {},
    });
    const res = await createEntry(req, routeContext({ id: 'x' }));
    expect(res.status).toBe(401);
  });

  it('returns 400 on a malformed site id', async () => {
    const req = await buildRequest(
      'http://localhost/api/v1/revenue/sites/not-a-uuid/affiliate-entries',
      {
        method: 'POST',
        body: { program: 'Y', periodStart: '2026-05-01', periodEnd: '2026-05-31', amountUsd: 10 },
      },
    );
    const res = await createEntry(req, routeContext({ id: 'not-a-uuid' }));
    expect(res.status).toBe(400);
  });

  it('creates an entry that the GET list then returns', async () => {
    const siteId = await seedSite();
    const post = await createEntry(
      await buildRequest(`http://localhost/api/v1/revenue/sites/${siteId}/affiliate-entries`, {
        method: 'POST',
        body: {
          program: 'Acme via Impact',
          periodStart: '2026-05-01',
          periodEnd: '2026-05-31',
          amountUsd: 123.45,
        },
      }),
      routeContext({ id: siteId }),
    );
    expect(post.status).toBe(201);
    const created = await readJson<{ data: { id: string; amountUsd: string } }>(post);
    expect(Number(created.data.amountUsd)).toBeCloseTo(123.45, 2);

    const list = await listEntries(
      await buildRequest(`http://localhost/api/v1/revenue/sites/${siteId}/affiliate-entries`),
      routeContext({ id: siteId }),
    );
    expect(list.status).toBe(200);
    const body = await readJson<{ data: Array<{ id: string }> }>(list);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.id).toBe(created.data.id);
  });
});
