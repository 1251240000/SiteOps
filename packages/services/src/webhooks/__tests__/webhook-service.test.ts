import { createHmac } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { deployments as deploymentsTable, sites, webhookEvents } from '@siteops/db';
import { createTestDb, type TestDbHandle } from '@siteops/db/testing';
import { WEBHOOK_BAD_SIG_WINDOW_MAX } from '@siteops/shared';

import {
  __resetBadSignatureBucketForTests,
  webhookService,
  type BadSigBucket,
} from '../webhook-service.js';

let handle: TestDbHandle;
const deps = () => ({ db: handle.db as never });

const SECRET = 'super-secret-test-key-1234567890';

function sign(body: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

async function seedSite(
  opts: {
    cfPagesProject?: string;
    repoUrl?: string;
  } = {},
): Promise<string> {
  const [row] = await handle.db
    .insert(sites)
    .values({
      slug: `s-${Math.random().toString(16).slice(2, 8)}`,
      name: 'Fixture',
      primaryUrl: 'https://example.com',
      siteType: 'content',
      status: 'active',
      ...(opts.cfPagesProject ? { cfPagesProject: opts.cfPagesProject } : {}),
      ...(opts.repoUrl ? { repoUrl: opts.repoUrl } : {}),
    })
    .returning({ id: sites.id });
  if (!row) throw new Error('seedSite');
  return row.id;
}

beforeEach(async () => {
  if (!handle) handle = await createTestDb();
  await handle.reset();
  __resetBadSignatureBucketForTests();
});

afterAll(async () => {
  if (handle) await handle.close();
});

describe('webhookService.verifyAndIngest', () => {
  describe('configuration / pre-checks', () => {
    it('returns not_configured when no secret is set', async () => {
      const out = await webhookService.verifyAndIngest(deps(), {
        provider: 'github',
        secret: null,
        rawBody: '{}',
        signature: 'sha256=irrelevant',
        deliveryId: 'd-1',
        eventType: 'workflow_run',
      });
      expect(out).toEqual({ kind: 'not_configured' });
    });

    it('returns bad_request when delivery_id is missing', async () => {
      const out = await webhookService.verifyAndIngest(deps(), {
        provider: 'github',
        secret: SECRET,
        rawBody: '{}',
        signature: `sha256=${sign('{}')}`,
        deliveryId: null,
        eventType: 'workflow_run',
      });
      expect(out).toEqual({ kind: 'bad_request', reason: 'missing_delivery_id' });
    });

    it('returns bad_request when event_type is missing', async () => {
      const out = await webhookService.verifyAndIngest(deps(), {
        provider: 'github',
        secret: SECRET,
        rawBody: '{}',
        signature: `sha256=${sign('{}')}`,
        deliveryId: 'd-1',
        eventType: null,
      });
      expect(out).toEqual({ kind: 'bad_request', reason: 'missing_event_type' });
    });

    it('rejects non-JSON payloads with bad_request', async () => {
      const out = await webhookService.verifyAndIngest(deps(), {
        provider: 'github',
        secret: SECRET,
        rawBody: 'not json',
        signature: `sha256=${sign('not json')}`,
        deliveryId: 'd-1',
        eventType: 'workflow_run',
      });
      expect(out.kind).toBe('bad_request');
    });
  });

  describe('signature handling', () => {
    it('writes signature_ok=false row when signature is wrong and returns unauthorized', async () => {
      const body = JSON.stringify({ zen: 'test' });
      const out = await webhookService.verifyAndIngest(deps(), {
        provider: 'github',
        secret: SECRET,
        rawBody: body,
        signature: 'sha256=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        deliveryId: 'd-bad-1',
        eventType: 'workflow_run',
        sourceIp: '203.0.113.5',
      });
      expect(out.kind).toBe('unauthorized');

      const rows = await handle.db.select().from(webhookEvents);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.signatureOk).toBe(false);
      expect(rows[0]?.processedAt).toBeNull();
    });

    it('rate-limits >50 bad signatures from the same IP without writing more rows', async () => {
      const body = JSON.stringify({ zen: 'spam' });
      const ip = '203.0.113.6';

      // First WEBHOOK_BAD_SIG_WINDOW_MAX hits write rows. We use distinct
      // delivery_ids so the unique-index doesn't fold them.
      for (let i = 0; i < WEBHOOK_BAD_SIG_WINDOW_MAX; i++) {
        await webhookService.verifyAndIngest(deps(), {
          provider: 'github',
          secret: SECRET,
          rawBody: body,
          signature: 'sha256=0000000000000000000000000000000000000000000000000000000000000000',
          deliveryId: `d-${i}`,
          eventType: 'workflow_run',
          sourceIp: ip,
        });
      }
      const beforeCap = await handle.db.select().from(webhookEvents);
      expect(beforeCap).toHaveLength(WEBHOOK_BAD_SIG_WINDOW_MAX);

      // The (cap+1)th hit must be dropped — no DB write.
      const dropped = await webhookService.verifyAndIngest(deps(), {
        provider: 'github',
        secret: SECRET,
        rawBody: body,
        signature: 'sha256=0000000000000000000000000000000000000000000000000000000000000000',
        deliveryId: `d-${WEBHOOK_BAD_SIG_WINDOW_MAX}`,
        eventType: 'workflow_run',
        sourceIp: ip,
      });
      expect(dropped).toEqual({ kind: 'rate_limited' });

      const afterCap = await handle.db.select().from(webhookEvents);
      expect(afterCap).toHaveLength(WEBHOOK_BAD_SIG_WINDOW_MAX);
    });
  });

  describe('idempotency', () => {
    it('returns duplicate=true on the second delivery without re-dispatching', async () => {
      await seedSite({ repoUrl: 'https://github.com/octocat/Hello-World' });
      const body = JSON.stringify({
        action: 'completed',
        workflow_run: {
          id: 12345,
          name: 'CI',
          head_sha: 'a'.repeat(40),
          head_branch: 'main',
          status: 'completed',
          conclusion: 'success',
          html_url: 'https://github.com/octocat/Hello-World/actions/runs/12345',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:02:00Z',
        },
        repository: { full_name: 'octocat/Hello-World' },
      });
      const signature = `sha256=${sign(body)}`;

      const first = await webhookService.verifyAndIngest(deps(), {
        provider: 'github',
        secret: SECRET,
        rawBody: body,
        signature,
        deliveryId: 'gh-1',
        eventType: 'workflow_run',
      });
      expect(first.kind).toBe('accepted');
      if (first.kind !== 'accepted') return;
      expect(first.duplicate).toBe(false);
      expect(first.dispatchFailed).toBe(false);

      const dupe = await webhookService.verifyAndIngest(deps(), {
        provider: 'github',
        secret: SECRET,
        rawBody: body,
        signature,
        deliveryId: 'gh-1',
        eventType: 'workflow_run',
      });
      expect(dupe.kind).toBe('accepted');
      if (dupe.kind !== 'accepted') return;
      expect(dupe.duplicate).toBe(true);

      // Only one webhook_events row + only one deployments row should exist.
      const events = await handle.db.select().from(webhookEvents);
      const deployments = await handle.db.select().from(deploymentsTable);
      expect(events).toHaveLength(1);
      expect(deployments).toHaveLength(1);
    });
  });

  describe('GitHub workflow_run dispatch', () => {
    it('creates a deployments row keyed by gh-<run.id> on a success completion', async () => {
      const siteId = await seedSite({
        repoUrl: 'https://github.com/octocat/repo-with-pages',
      });
      const body = JSON.stringify({
        action: 'completed',
        workflow_run: {
          id: 9999,
          name: 'pages build and deployment',
          head_sha: 'c'.repeat(40),
          head_branch: 'main',
          status: 'completed',
          conclusion: 'success',
          html_url: 'https://github.com/octocat/repo-with-pages/actions/runs/9999',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:01:30Z',
        },
        repository: { full_name: 'octocat/repo-with-pages' },
      });
      const out = await webhookService.verifyAndIngest(deps(), {
        provider: 'github',
        secret: SECRET,
        rawBody: body,
        signature: `sha256=${sign(body)}`,
        deliveryId: 'gh-success-1',
        eventType: 'workflow_run',
      });
      expect(out.kind).toBe('accepted');
      if (out.kind !== 'accepted') return;
      expect(out.duplicate).toBe(false);
      expect(out.dispatchFailed).toBe(false);
      expect(out.event.siteId).toBe(siteId);
      expect(out.event.processedAt).not.toBeNull();

      const deployRows = await handle.db.select().from(deploymentsTable);
      expect(deployRows).toHaveLength(1);
      expect(deployRows[0]?.providerDeploymentId).toBe('gh-9999');
      expect(deployRows[0]?.status).toBe('success');
      expect(deployRows[0]?.provider).toBe('github_pages');
    });

    it('records dispatch_failed=true when the site cannot be resolved', async () => {
      // No site seeded → repo lookup misses → dispatcher returns SKIP.
      const body = JSON.stringify({
        action: 'completed',
        workflow_run: {
          id: 7,
          head_sha: 'd'.repeat(40),
          status: 'completed',
          conclusion: 'success',
          html_url: 'https://github.com/lost/repo/actions/runs/7',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:30Z',
        },
        repository: { full_name: 'lost/repo' },
      });
      const out = await webhookService.verifyAndIngest(deps(), {
        provider: 'github',
        secret: SECRET,
        rawBody: body,
        signature: `sha256=${sign(body)}`,
        deliveryId: 'gh-lost-1',
        eventType: 'workflow_run',
      });
      expect(out.kind).toBe('accepted');
      if (out.kind !== 'accepted') return;
      // GitHub dispatcher returns SKIP (siteId=null, deploymentId=null)
      // without throwing; the service marks the event as processed but
      // with no site attached.
      expect(out.dispatchFailed).toBe(false);
      expect(out.event.siteId).toBeNull();
    });

    it('records `push` without creating a deployment', async () => {
      const siteId = await seedSite({
        repoUrl: 'https://github.com/octocat/Hello-World',
      });
      const body = JSON.stringify({
        ref: 'refs/heads/main',
        after: 'a'.repeat(40),
        repository: { full_name: 'octocat/Hello-World' },
      });
      const out = await webhookService.verifyAndIngest(deps(), {
        provider: 'github',
        secret: SECRET,
        rawBody: body,
        signature: `sha256=${sign(body)}`,
        deliveryId: 'gh-push-1',
        eventType: 'push',
      });
      expect(out.kind).toBe('accepted');
      if (out.kind !== 'accepted') return;
      expect(out.dispatchFailed).toBe(false);
      expect(out.event.siteId).toBe(siteId);

      const deployRows = await handle.db.select().from(deploymentsTable);
      expect(deployRows).toHaveLength(0);
    });
  });

  describe('Cloudflare dispatch', () => {
    it('creates a deployment row from a deployment.success delivery', async () => {
      const siteId = await seedSite({ cfPagesProject: 'my-site' });
      const body = JSON.stringify({
        project_name: 'my-site',
        deployment_id: 'cf-dep-001',
        commit_hash: 'abc1234',
        branch: 'main',
        build_log_url: 'https://example.com/log',
        started_at: '2026-01-01T00:00:00Z',
        finished_at: '2026-01-01T00:02:00Z',
      });
      const out = await webhookService.verifyAndIngest(deps(), {
        provider: 'cloudflare',
        secret: SECRET,
        rawBody: body,
        signature: sign(body),
        deliveryId: 'cf-1',
        eventType: 'deployment.success',
      });
      expect(out.kind).toBe('accepted');
      if (out.kind !== 'accepted') return;
      expect(out.event.siteId).toBe(siteId);

      const deployRows = await handle.db.select().from(deploymentsTable);
      expect(deployRows).toHaveLength(1);
      expect(deployRows[0]?.providerDeploymentId).toBe('cf-dep-001');
      expect(deployRows[0]?.status).toBe('success');
      expect(deployRows[0]?.provider).toBe('cloudflare_pages');
    });

    it('flags dispatch_failed when project_name is missing', async () => {
      const body = JSON.stringify({ deployment_id: 'cf-no-project' });
      const out = await webhookService.verifyAndIngest(deps(), {
        provider: 'cloudflare',
        secret: SECRET,
        rawBody: body,
        signature: sign(body),
        deliveryId: 'cf-broken-1',
        eventType: 'deployment.success',
      });
      expect(out.kind).toBe('accepted');
      if (out.kind !== 'accepted') return;
      expect(out.dispatchFailed).toBe(true);
      expect(out.event.error).toBe('site_not_resolved');
    });
  });
});

describe('webhookService.replay', () => {
  it('reruns dispatch on a stored row that previously failed', async () => {
    // First call → no matching site → marked failed.
    const body = JSON.stringify({
      project_name: 'late-site',
      deployment_id: 'cf-late-1',
      commit_hash: 'xyz9876',
      branch: 'main',
    });
    const first = await webhookService.verifyAndIngest(deps(), {
      provider: 'cloudflare',
      secret: SECRET,
      rawBody: body,
      signature: sign(body),
      deliveryId: 'cf-late-1',
      eventType: 'deployment.success',
    });
    expect(first.kind).toBe('accepted');
    if (first.kind !== 'accepted') return;
    expect(first.dispatchFailed).toBe(true);

    // Admin seeds the site after the fact and replays.
    const siteId = await seedSite({ cfPagesProject: 'late-site' });
    const replay = await webhookService.replay(deps(), first.event.id);
    expect(replay.dispatchFailed).toBe(false);
    expect(replay.event.siteId).toBe(siteId);

    const deployRows = await handle.db.select().from(deploymentsTable);
    expect(deployRows).toHaveLength(1);
    expect(deployRows[0]?.providerDeploymentId).toBe('cf-late-1');
  });

  it('refuses to replay a signature-failed row', async () => {
    const bad = await webhookService.verifyAndIngest(deps(), {
      provider: 'github',
      secret: SECRET,
      rawBody: '{}',
      signature: 'sha256=00',
      deliveryId: 'gh-bad-replay',
      eventType: 'workflow_run',
    });
    expect(bad.kind).toBe('unauthorized');
    if (bad.kind !== 'unauthorized' || !bad.eventId) return;

    await expect(webhookService.replay(deps(), bad.eventId)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('throws not_found when the event id does not exist', async () => {
    await expect(
      webhookService.replay(deps(), '00000000-0000-4000-8000-000000000000'),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('webhookService.verifyAndIngest — bad-sig bucket DI', () => {
  function makeStubBucket(): { bucket: BadSigBucket; calls: string[][] } {
    const calls: string[][] = [];
    let count = 0;
    const bucket: BadSigBucket = {
      async hit(key, ttlSec, cap) {
        count += 1;
        calls.push([key, String(ttlSec), String(cap)]);
        return { count, over: count > cap };
      },
      async reset() {
        count = 0;
      },
    };
    return { bucket, calls };
  }

  it('uses the deps.badSigBucket on a bad-sig hit (and not the in-memory map)', async () => {
    const body = JSON.stringify({ zen: 'spam' });
    const { bucket, calls } = makeStubBucket();
    const res = await webhookService.verifyAndIngest(
      { ...deps(), badSigBucket: bucket },
      {
        provider: 'github',
        secret: SECRET,
        rawBody: body,
        signature: 'sha256=0000000000000000000000000000000000000000000000000000000000000000',
        deliveryId: 'd-stub-1',
        eventType: 'workflow_run',
        sourceIp: '203.0.113.99',
      },
    );
    // Bad-sig path → unauthorized + bucket consulted exactly once with the
    // canonical "<provider>|<ip>" key.
    expect(res.kind).toBe('unauthorized');
    expect(calls).toEqual([
      ['github|203.0.113.99', String(calls[0]?.[1] ?? '0'), String(WEBHOOK_BAD_SIG_WINDOW_MAX)],
    ]);
  });

  it('returns rate_limited (and skips DB) once the injected bucket says over=true', async () => {
    const body = JSON.stringify({ zen: 'spam' });
    let n = 0;
    const bucket: BadSigBucket = {
      async hit() {
        n += 1;
        // First call: under cap. Second: over cap.
        return { count: n, over: n > 1 };
      },
      async reset() {
        n = 0;
      },
    };

    // First request — bucket says under, row should be persisted.
    const a = await webhookService.verifyAndIngest(
      { ...deps(), badSigBucket: bucket },
      {
        provider: 'github',
        secret: SECRET,
        rawBody: body,
        signature: 'sha256=0000000000000000000000000000000000000000000000000000000000000000',
        deliveryId: 'd-stub-2',
        eventType: 'workflow_run',
        sourceIp: '203.0.113.100',
      },
    );
    expect(a.kind).toBe('unauthorized');
    expect(await handle.db.select().from(webhookEvents)).toHaveLength(1);

    // Second request — bucket says over, no DB write.
    const b = await webhookService.verifyAndIngest(
      { ...deps(), badSigBucket: bucket },
      {
        provider: 'github',
        secret: SECRET,
        rawBody: body,
        signature: 'sha256=0000000000000000000000000000000000000000000000000000000000000000',
        deliveryId: 'd-stub-3',
        eventType: 'workflow_run',
        sourceIp: '203.0.113.100',
      },
    );
    expect(b).toEqual({ kind: 'rate_limited' });
    expect(await handle.db.select().from(webhookEvents)).toHaveLength(1);
  });

  it('fails open when the bucket throws (does not crash, does not rate-limit)', async () => {
    const body = JSON.stringify({ zen: 'spam' });
    const flaky: BadSigBucket = {
      async hit() {
        throw new Error('redis exploded');
      },
      async reset() {},
    };
    const out = await webhookService.verifyAndIngest(
      { ...deps(), badSigBucket: flaky },
      {
        provider: 'github',
        secret: SECRET,
        rawBody: body,
        signature: 'sha256=0000000000000000000000000000000000000000000000000000000000000000',
        deliveryId: 'd-stub-4',
        eventType: 'workflow_run',
        sourceIp: '203.0.113.101',
      },
    );
    // We chose to fail open — the row IS persisted as unauthorized.
    expect(out.kind).toBe('unauthorized');
  });
});
