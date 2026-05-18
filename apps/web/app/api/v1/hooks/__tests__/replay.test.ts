/**
 * Route-handler tests for `POST /api/v1/hooks/:provider/replay/:id`.
 *
 * Covers:
 *   - 401 when unauthenticated (admin session is mandatory)
 *   - 200 + dispatch_failed=false after seeding a matching site post-hoc
 *     (the original delivery had `error='site_not_resolved'`)
 *   - 400 when the URL path's provider doesn't match the row's provider
 *   - 403 when trying to replay a signature-failed row
 */
import { createHmac } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/db', () => ({ getDb: vi.fn() }));
vi.mock('@/lib/env', () => ({ getEnv: vi.fn() }));

import { deployments as deploymentsTable, sites } from '@siteops/db';
import { webhooks as webhookSvc } from '@siteops/services';

import { POST as cloudflareHook } from '@/app/api/v1/hooks/cloudflare/route';
import { POST as githubHook } from '@/app/api/v1/hooks/github/route';
import { POST as replayHook } from '@/app/api/v1/hooks/[provider]/replay/[id]/route';

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

const CF_SECRET = 'cf-replay-secret-1234567890-abcd';
const GH_SECRET = 'gh-replay-secret-1234567890-abcd';

function signCf(body: string): string {
  return createHmac('sha256', CF_SECRET).update(body, 'utf8').digest('hex');
}
function signGh(body: string): string {
  return `sha256=${createHmac('sha256', GH_SECRET).update(body, 'utf8').digest('hex')}`;
}

async function setEnv(): Promise<void> {
  const mod = await import('@/lib/env');
  vi.mocked(mod.getEnv as unknown as () => unknown).mockReturnValue({
    NODE_ENV: 'test',
    AUTH_SECRET: 'dev',
    LOG_LEVEL: 'info',
    LOGIN_RATE_LIMIT_PER_MIN: 5,
    CF_WEBHOOK_SECRET: CF_SECRET,
    GH_WEBHOOK_SECRET: GH_SECRET,
  });
}

beforeAll(async () => {
  await setupTestDb();
  await bindDbMock();
});

beforeEach(async () => {
  await resetDb();
  webhookSvc.__resetBadSignatureBucketForTests();
  await setEnv();
  await setSession(FAKE_SESSION);
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe('POST /api/v1/hooks/:provider/replay/:id', () => {
  it('requires an admin session (401 without one)', async () => {
    // Seed a real event by sending a (deliberately unresolvable) CF delivery.
    const body = JSON.stringify({
      project_name: 'late-site',
      deployment_id: 'cf-late-1',
    });
    const inbound = await cloudflareHook(
      await buildRequest('http://localhost/api/v1/hooks/cloudflare', {
        method: 'POST',
        body: JSON.parse(body),
        headers: {
          'cf-webhook-auth': signCf(body),
          'cf-webhook-id': 'cf-late-1',
          'cf-webhook-name': 'deployment.success',
        },
      }),
    );
    const inboundBody = await readJson<{ data: { id: string } }>(inbound);
    const eventId = inboundBody.data.id;

    await setSession(null);
    const res = await replayHook(
      await buildRequest(`http://localhost/api/v1/hooks/cloudflare/replay/${eventId}`, {
        method: 'POST',
      }),
      routeContext({ provider: 'cloudflare', id: eventId }),
    );
    expect(res.status).toBe(401);
  });

  it('re-dispatches a CF event after the matching site is seeded', async () => {
    const handle = await setupTestDb();
    // First delivery — no site → marked failed.
    const body = JSON.stringify({
      project_name: 'late-site',
      deployment_id: 'cf-late-1',
      commit_hash: 'xyz9876',
      branch: 'main',
    });
    const inbound = await cloudflareHook(
      await buildRequest('http://localhost/api/v1/hooks/cloudflare', {
        method: 'POST',
        body: JSON.parse(body),
        headers: {
          'cf-webhook-auth': signCf(body),
          'cf-webhook-id': 'cf-late-1',
          'cf-webhook-name': 'deployment.success',
        },
      }),
    );
    const inboundBody = await readJson<{
      data: { id: string };
      meta?: { dispatch_failed?: boolean };
    }>(inbound);
    expect(inboundBody.meta?.dispatch_failed).toBe(true);
    const eventId = inboundBody.data.id;

    // Now the admin seeds the site and replays.
    const [siteRow] = await handle.db
      .insert(sites)
      .values({
        slug: 'late-site',
        name: 'Late Site',
        primaryUrl: 'https://late-site.pages.dev',
        siteType: 'content',
        cfPagesProject: 'late-site',
      })
      .returning({ id: sites.id });

    const res = await replayHook(
      await buildRequest(`http://localhost/api/v1/hooks/cloudflare/replay/${eventId}`, {
        method: 'POST',
      }),
      routeContext({ provider: 'cloudflare', id: eventId }),
    );
    expect(res.status).toBe(200);
    const json = await readJson<{
      data: { dispatchFailed: boolean; event: { id: string } };
    }>(res);
    expect(json.data.dispatchFailed).toBe(false);

    const deps = await handle.db.select().from(deploymentsTable);
    expect(deps).toHaveLength(1);
    expect(deps[0]?.siteId).toBe(siteRow!.id);
    expect(deps[0]?.providerDeploymentId).toBe('cf-late-1');
  });

  it('returns 400 when the URL provider does not match the event', async () => {
    // Ingest a GitHub event…
    const payload = {
      action: 'completed',
      workflow_run: {
        id: 1,
        head_sha: 'a'.repeat(40),
        status: 'completed',
        conclusion: 'success',
        html_url: 'https://github.com/x/y/actions/runs/1',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:30Z',
      },
      repository: { full_name: 'x/y' },
    };
    const body = JSON.stringify(payload);
    const inbound = await githubHook(
      await buildRequest('http://localhost/api/v1/hooks/github', {
        method: 'POST',
        body: payload,
        headers: {
          'x-hub-signature-256': signGh(body),
          'x-github-delivery': 'gh-cross-1',
          'x-github-event': 'workflow_run',
        },
      }),
    );
    const { data } = await readJson<{ data: { id: string } }>(inbound);

    // …then call the CLOUDFLARE replay path with the same id → mismatch.
    const res = await replayHook(
      await buildRequest(`http://localhost/api/v1/hooks/cloudflare/replay/${data.id}`, {
        method: 'POST',
      }),
      routeContext({ provider: 'cloudflare', id: data.id }),
    );
    expect(res.status).toBe(400);
    const err = await readJson<{ error: { code: string } }>(res);
    expect(err.error.code).toBe('validation_failed');
  });

  it('returns 403 when trying to replay a signature-failed row', async () => {
    const body = JSON.stringify({ zen: 'reject' });
    const inbound = await githubHook(
      await buildRequest('http://localhost/api/v1/hooks/github', {
        method: 'POST',
        body: JSON.parse(body),
        headers: {
          'x-hub-signature-256': 'sha256=00',
          'x-github-delivery': 'gh-bad-replay',
          'x-github-event': 'ping',
        },
      }),
    );
    expect(inbound.status).toBe(401);
    const bad = await readJson<{ error: { details?: { eventId?: string } } }>(inbound);
    const eventId = bad.error.details?.eventId;
    expect(eventId).toBeDefined();

    const res = await replayHook(
      await buildRequest(`http://localhost/api/v1/hooks/github/replay/${eventId}`, {
        method: 'POST',
      }),
      routeContext({ provider: 'github', id: eventId! }),
    );
    expect(res.status).toBe(403);
  });
});
