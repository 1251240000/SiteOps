/**
 * Route-handler tests for `/api/v1/hooks/cloudflare`.
 *
 * Exercises:
 *   - the 503/415/401 short-circuits
 *   - idempotency on re-delivery (200 + duplicate=true)
 *   - end-to-end signed delivery → `deployments` row created
 */
import { createHmac } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/db', () => ({ getDb: vi.fn() }));
vi.mock('@/lib/env', () => ({ getEnv: vi.fn() }));

import { deployments as deploymentsTable, sites, webhookEvents } from '@siteops/db';
import { webhooks as webhookSvc } from '@siteops/services';

import { POST as cloudflareHook } from '@/app/api/v1/hooks/cloudflare/route';

import { bindDbMock, buildRequest, readJson, resetDb, setupTestDb } from '@/__tests__/helpers';

const SECRET = 'super-secret-test-key-1234567890';

function sign(body: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

async function setEnv(secret: string | undefined): Promise<void> {
  const mod = await import('@/lib/env');
  vi.mocked(mod.getEnv as unknown as () => unknown).mockReturnValue({
    NODE_ENV: 'test',
    AUTH_SECRET: 'dev',
    LOG_LEVEL: 'info',
    LOGIN_RATE_LIMIT_PER_MIN: 5,
    ...(secret ? { CF_WEBHOOK_SECRET: secret } : {}),
  });
}

async function seedSite(cfPagesProject: string): Promise<string> {
  const handle = await setupTestDb();
  const [row] = await handle.db
    .insert(sites)
    .values({
      slug: `cf-${cfPagesProject}`,
      name: cfPagesProject,
      primaryUrl: `https://${cfPagesProject}.pages.dev`,
      siteType: 'content',
      cfPagesProject,
    })
    .returning({ id: sites.id });
  if (!row) throw new Error('seedSite');
  return row.id;
}

beforeAll(async () => {
  await setupTestDb();
  await bindDbMock();
});

beforeEach(async () => {
  await resetDb();
  webhookSvc.__resetBadSignatureBucketForTests();
  await setEnv(SECRET);
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe('POST /api/v1/hooks/cloudflare', () => {
  it('returns 503 webhook_not_configured when CF_WEBHOOK_SECRET is missing', async () => {
    await setEnv(undefined);
    const body = JSON.stringify({ project_name: 'x' });
    const res = await cloudflareHook(
      await buildRequest('http://localhost/api/v1/hooks/cloudflare', {
        method: 'POST',
        body: JSON.parse(body),
        headers: {
          'cf-webhook-auth': sign(body),
          'cf-webhook-id': 'd-1',
          'cf-webhook-name': 'deployment.success',
        },
      }),
    );
    expect(res.status).toBe(503);
    const json = await readJson<{ error: { code: string } }>(res);
    expect(json.error.code).toBe('webhook_not_configured');
  });

  it('returns 415 when Content-Type is not application/json', async () => {
    const body = 'plain text';
    const { NextRequest } = await import('next/server');
    const req = new NextRequest('http://localhost/api/v1/hooks/cloudflare', {
      method: 'POST',
      headers: {
        'content-type': 'text/plain',
        'cf-webhook-auth': sign(body),
        'cf-webhook-id': 'd-text-1',
        'cf-webhook-name': 'deployment.success',
      },
      body,
    });
    const res = await cloudflareHook(req);
    expect(res.status).toBe(415);
  });

  it('returns 401 and audits the row when the signature is wrong', async () => {
    const handle = await setupTestDb();
    const body = JSON.stringify({ project_name: 'x', deployment_id: 'd-1' });
    const res = await cloudflareHook(
      await buildRequest('http://localhost/api/v1/hooks/cloudflare', {
        method: 'POST',
        body: JSON.parse(body),
        headers: {
          'cf-webhook-auth': 'deadbeef',
          'cf-webhook-id': 'd-bad-1',
          'cf-webhook-name': 'deployment.success',
        },
      }),
    );
    expect(res.status).toBe(401);

    const rows = await handle.db.select().from(webhookEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.signatureOk).toBe(false);
  });

  it('202 + duplicate=false on a fresh signed delivery; 200 + duplicate=true on a re-delivery', async () => {
    const handle = await setupTestDb();
    const siteId = await seedSite('first-site');
    const body = JSON.stringify({
      project_name: 'first-site',
      deployment_id: 'cf-dep-001',
      commit_hash: 'aabbcc',
      branch: 'main',
    });

    const first = await cloudflareHook(
      await buildRequest('http://localhost/api/v1/hooks/cloudflare', {
        method: 'POST',
        body: JSON.parse(body),
        headers: {
          'cf-webhook-auth': sign(body),
          'cf-webhook-id': 'cf-deliv-1',
          'cf-webhook-name': 'deployment.success',
        },
      }),
    );
    expect(first.status).toBe(202);
    const firstBody = await readJson<{ data: { id: string; duplicate: boolean } }>(first);
    expect(firstBody.data.duplicate).toBe(false);

    const second = await cloudflareHook(
      await buildRequest('http://localhost/api/v1/hooks/cloudflare', {
        method: 'POST',
        body: JSON.parse(body),
        headers: {
          'cf-webhook-auth': sign(body),
          'cf-webhook-id': 'cf-deliv-1',
          'cf-webhook-name': 'deployment.success',
        },
      }),
    );
    expect(second.status).toBe(200);
    const secondBody = await readJson<{ data: { id: string; duplicate: boolean } }>(second);
    expect(secondBody.data.duplicate).toBe(true);
    expect(secondBody.data.id).toBe(firstBody.data.id);

    // Single deployment row, single webhook_event row.
    const dep = await handle.db.select().from(deploymentsTable);
    expect(dep).toHaveLength(1);
    expect(dep[0]?.siteId).toBe(siteId);
    expect(dep[0]?.providerDeploymentId).toBe('cf-dep-001');
    expect(dep[0]?.status).toBe('success');

    const events = await handle.db.select().from(webhookEvents);
    expect(events).toHaveLength(1);
    expect(events[0]?.processedAt).not.toBeNull();
  });

  it('records meta.dispatch_failed when project_name does not match any site', async () => {
    const body = JSON.stringify({ project_name: 'no-such-site', deployment_id: 'cf-mystery' });
    const res = await cloudflareHook(
      await buildRequest('http://localhost/api/v1/hooks/cloudflare', {
        method: 'POST',
        body: JSON.parse(body),
        headers: {
          'cf-webhook-auth': sign(body),
          'cf-webhook-id': 'cf-mystery-1',
          'cf-webhook-name': 'deployment.success',
        },
      }),
    );
    expect(res.status).toBe(202);
    const json = await readJson<{ data: unknown; meta?: { dispatch_failed?: boolean } }>(res);
    expect(json.meta?.dispatch_failed).toBe(true);
  });
});
