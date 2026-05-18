/**
 * Route-handler tests for `/api/v1/hooks/github`.
 *
 * Covers configuration gating, signature handling, the workflow_run success
 * path (one `deployments` row created with provider=github_pages), and the
 * push event (no deployment row, but webhook_event recorded).
 */
import { createHmac } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/db', () => ({ getDb: vi.fn() }));
vi.mock('@/lib/env', () => ({ getEnv: vi.fn() }));

import { deployments as deploymentsTable, sites, webhookEvents } from '@siteops/db';
import { webhooks as webhookSvc } from '@siteops/services';

import { POST as githubHook } from '@/app/api/v1/hooks/github/route';

import { bindDbMock, buildRequest, readJson, resetDb, setupTestDb } from '@/__tests__/helpers';

const SECRET = 'gh-webhook-secret-1234567890-abcd';

function sign(body: string, secret = SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;
}

async function setEnv(secret: string | undefined): Promise<void> {
  const mod = await import('@/lib/env');
  vi.mocked(mod.getEnv as unknown as () => unknown).mockReturnValue({
    NODE_ENV: 'test',
    AUTH_SECRET: 'dev',
    LOG_LEVEL: 'info',
    LOGIN_RATE_LIMIT_PER_MIN: 5,
    ...(secret ? { GH_WEBHOOK_SECRET: secret } : {}),
  });
}

async function seedSite(repoUrl: string): Promise<string> {
  const handle = await setupTestDb();
  const [row] = await handle.db
    .insert(sites)
    .values({
      slug: `gh-${Math.random().toString(16).slice(2, 8)}`,
      name: 'fixture',
      primaryUrl: 'https://example.com',
      siteType: 'content',
      repoUrl,
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

describe('POST /api/v1/hooks/github', () => {
  it('returns 503 webhook_not_configured when GH_WEBHOOK_SECRET is missing', async () => {
    await setEnv(undefined);
    const body = JSON.stringify({ zen: 'hi' });
    const res = await githubHook(
      await buildRequest('http://localhost/api/v1/hooks/github', {
        method: 'POST',
        body: JSON.parse(body),
        headers: {
          'x-hub-signature-256': sign(body),
          'x-github-delivery': 'gh-1',
          'x-github-event': 'ping',
        },
      }),
    );
    expect(res.status).toBe(503);
  });

  it('returns 415 when Content-Type is not application/json', async () => {
    const body = JSON.stringify({ zen: 'hi' });
    const { NextRequest } = await import('next/server');
    const req = new NextRequest('http://localhost/api/v1/hooks/github', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-hub-signature-256': sign(body),
        'x-github-delivery': 'gh-form-1',
        'x-github-event': 'ping',
      },
      body,
    });
    const res = await githubHook(req);
    expect(res.status).toBe(415);
  });

  it('writes signature_ok=false and returns 401 on a tampered body', async () => {
    const handle = await setupTestDb();
    const original = JSON.stringify({ zen: 'first' });
    const tampered = JSON.stringify({ zen: 'second' });
    const res = await githubHook(
      await buildRequest('http://localhost/api/v1/hooks/github', {
        method: 'POST',
        body: JSON.parse(tampered),
        headers: {
          'x-hub-signature-256': sign(original),
          'x-github-delivery': 'gh-tamper-1',
          'x-github-event': 'ping',
        },
      }),
    );
    expect(res.status).toBe(401);

    const rows = await handle.db.select().from(webhookEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.signatureOk).toBe(false);
  });

  it('accepts a signed workflow_run.completed and creates a deployments row', async () => {
    const handle = await setupTestDb();
    const siteId = await seedSite('https://github.com/octocat/pages-site');
    const payload = {
      action: 'completed',
      workflow_run: {
        id: 8000,
        name: 'pages build and deployment',
        head_sha: 'b'.repeat(40),
        head_branch: 'main',
        status: 'completed',
        conclusion: 'success',
        html_url: 'https://github.com/octocat/pages-site/actions/runs/8000',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:02:00Z',
      },
      repository: { full_name: 'octocat/pages-site' },
    };
    const body = JSON.stringify(payload);
    const res = await githubHook(
      await buildRequest('http://localhost/api/v1/hooks/github', {
        method: 'POST',
        body: payload,
        headers: {
          'x-hub-signature-256': sign(body),
          'x-github-delivery': 'gh-success-1',
          'x-github-event': 'workflow_run',
        },
      }),
    );
    expect(res.status).toBe(202);
    const env = await readJson<{ data: { id: string; duplicate: boolean } }>(res);
    expect(env.data.duplicate).toBe(false);

    const deps = await handle.db.select().from(deploymentsTable);
    expect(deps).toHaveLength(1);
    expect(deps[0]?.providerDeploymentId).toBe('gh-8000');
    expect(deps[0]?.status).toBe('success');
    expect(deps[0]?.provider).toBe('github_pages');
    expect(deps[0]?.siteId).toBe(siteId);
  });

  it('accepts push events without creating a deployment row', async () => {
    const handle = await setupTestDb();
    const siteId = await seedSite('https://github.com/octocat/Hello-World');
    const payload = {
      ref: 'refs/heads/main',
      after: 'a'.repeat(40),
      repository: { full_name: 'octocat/Hello-World' },
    };
    const body = JSON.stringify(payload);
    const res = await githubHook(
      await buildRequest('http://localhost/api/v1/hooks/github', {
        method: 'POST',
        body: payload,
        headers: {
          'x-hub-signature-256': sign(body),
          'x-github-delivery': 'gh-push-1',
          'x-github-event': 'push',
        },
      }),
    );
    expect(res.status).toBe(202);

    const events = await handle.db.select().from(webhookEvents);
    expect(events).toHaveLength(1);
    expect(events[0]?.siteId).toBe(siteId);

    const deps = await handle.db.select().from(deploymentsTable);
    expect(deps).toHaveLength(0);
  });
});
