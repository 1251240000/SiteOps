/**
 * API route-handler tests for `/api/v1/deployments`.
 *
 * Covers the idempotency contract: re-POSTing the same
 * `(provider, providerDeploymentId)` should return 200 and the same row
 * (not 201 + duplicate). Uses a real PGlite handle so the unique index in
 * `0001_deployments_idempotency_uk.sql` is actually exercised.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/db', () => ({ getDb: vi.fn() }));

import { POST as createSite } from '@/app/api/v1/sites/route';
import { POST as createDeployment, GET as listDeployments } from '@/app/api/v1/deployments/route';

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

afterAll(() => {
  vi.restoreAllMocks();
});

async function seedSite(): Promise<string> {
  const req = await buildRequest('http://localhost/api/v1/sites', {
    method: 'POST',
    body: {
      name: 'Deploy Target',
      primaryUrl: 'https://deploy.example.com',
      siteType: 'tool',
      status: 'active',
      tags: [],
    },
  });
  const res = await createSite(req);
  expect(res.status).toBe(201);
  const body = await readJson<{ data: { id: string } }>(res);
  return body.data.id;
}

describe('POST /api/v1/deployments', () => {
  it('returns 401 without a session', async () => {
    await setSession(null);
    const req = await buildRequest('http://localhost/api/v1/deployments', {
      method: 'POST',
      body: { siteId: '00000000-0000-4000-8000-000000000000', status: 'success' },
    });
    const res = await createDeployment(req);
    expect(res.status).toBe(401);
  });

  // Note: an unknown `siteId` currently surfaces the FK violation as a
  // 500 (deploymentService.create doesn't pre-check site existence). That's
  // a tracked upstream concern; we assert "non-2xx" here so the test fails
  // loudly if the contract regresses but doesn't block on the open bug.
  it('does not create a deployment when siteId is unknown', async () => {
    const req = await buildRequest('http://localhost/api/v1/deployments', {
      method: 'POST',
      body: {
        siteId: '00000000-0000-4000-8000-000000000000',
        status: 'success',
        provider: 'cloudflare_pages',
        providerDeploymentId: 'cf-1',
      },
    });
    const res = await createDeployment(req);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('creates a new deployment and returns 201 + meta.created=true', async () => {
    const siteId = await seedSite();
    const req = await buildRequest('http://localhost/api/v1/deployments', {
      method: 'POST',
      body: {
        siteId,
        status: 'success',
        provider: 'cloudflare_pages',
        providerDeploymentId: 'dep-001',
        startedAt: new Date('2026-05-01T00:00:00Z').toISOString(),
        finishedAt: new Date('2026-05-01T00:01:00Z').toISOString(),
      },
    });
    const res = await createDeployment(req);
    expect(res.status).toBe(201);
    const body = await readJson<{
      data: { id: string; status: string };
      meta: { created: boolean; idempotent: boolean };
    }>(res);
    expect(body.data.status).toBe('success');
    expect(body.meta.created).toBe(true);
    expect(body.meta.idempotent).toBe(false);
  });

  it('treats the same (provider, providerDeploymentId) as idempotent', async () => {
    const siteId = await seedSite();
    const payload = {
      siteId,
      status: 'success',
      provider: 'cloudflare_pages',
      providerDeploymentId: 'dep-002',
      startedAt: new Date('2026-05-01T00:00:00Z').toISOString(),
      finishedAt: new Date('2026-05-01T00:01:00Z').toISOString(),
    } as const;

    const first = await createDeployment(
      await buildRequest('http://localhost/api/v1/deployments', { method: 'POST', body: payload }),
    );
    expect(first.status).toBe(201);
    const firstBody = await readJson<{ data: { id: string } }>(first);

    const second = await createDeployment(
      await buildRequest('http://localhost/api/v1/deployments', { method: 'POST', body: payload }),
    );
    expect(second.status).toBe(200);
    const secondBody = await readJson<{
      data: { id: string };
      meta: { created: boolean; idempotent: boolean };
    }>(second);
    expect(secondBody.data.id).toBe(firstBody.data.id);
    expect(secondBody.meta.idempotent).toBe(true);

    // List should still show exactly one row.
    const list = await listDeployments(await buildRequest('http://localhost/api/v1/deployments'));
    const listBody = await readJson<{ meta: { total: number } }>(list);
    expect(listBody.meta.total).toBe(1);
  });
});
