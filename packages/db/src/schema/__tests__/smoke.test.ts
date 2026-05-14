import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestDb, type TestDbHandle } from '../../testing.js';
import { adsenseDaily } from '../metrics.js';
import { agentRuns } from '../agent-runs.js';
import { alertChannels, alertRules, alerts } from '../alerts.js';
import { apiKeys } from '../api-keys.js';
import { auditFindings, auditRuns } from '../audits.js';
import { deployments } from '../deployments.js';
import { domains } from '../domains.js';
import { errors } from '../errors.js';
import { jobsLog } from '../jobs-log.js';
import { metricsDaily, searchConsoleDaily } from '../metrics.js';
import { sites } from '../sites.js';
import { uptimeChecks } from '../uptime-checks.js';
import { users } from '../users.js';

let handle: TestDbHandle;

// Shared parent rows so dependent inserts always have valid FKs.
let siteId: string;
let apiKeyId: string;
let auditRunId: string;
let alertRuleId: string;

beforeAll(async () => {
  handle = await createTestDb();
  const { db } = handle;

  const [site] = await db
    .insert(sites)
    .values({
      slug: 'parent-site',
      name: 'Parent Site',
      primaryUrl: 'https://example.com',
      siteType: 'tool',
    })
    .returning({ id: sites.id });
  siteId = site!.id;

  const [apiKey] = await db
    .insert(apiKeys)
    .values({
      name: 'fixture',
      keyHash: 'bcrypt$placeholder',
      keyPrefix: 'sk_test_',
      scopes: ['sites:read'],
    })
    .returning({ id: apiKeys.id });
  apiKeyId = apiKey!.id;

  const [run] = await db
    .insert(auditRuns)
    .values({ siteId, auditType: 'seo', status: 'success', score: 88 })
    .returning({ id: auditRuns.id });
  auditRunId = run!.id;

  const [rule] = await db
    .insert(alertRules)
    .values({
      name: 'uptime warn',
      scope: 'site',
      siteId,
      metric: 'uptime',
      operator: 'lt',
      threshold: '0.99',
    })
    .returning({ id: alertRules.id });
  alertRuleId = rule!.id;
});

afterAll(async () => {
  await handle.close();
});

describe('schema smoke tests', () => {
  it('users: insert + read', async () => {
    const { db } = handle;
    const [inserted] = await db
      .insert(users)
      .values({
        email: 'smoke@example.com',
        passwordHash: 'bcrypt$placeholder',
        name: 'Smoke',
      })
      .returning();
    expect(inserted?.id).toMatch(/^[0-9a-f-]{36}$/);

    const round = await db.select().from(users).where(eq(users.email, 'smoke@example.com'));
    expect(round).toHaveLength(1);
    expect(round[0]?.name).toBe('Smoke');
    expect(round[0]?.createdAt).toBeInstanceOf(Date);
  });

  it('api_keys: insert + read', async () => {
    const { db } = handle;
    const row = await db.select().from(apiKeys).where(eq(apiKeys.id, apiKeyId));
    expect(row[0]?.scopes).toEqual(['sites:read']);
  });

  it('sites: insert + read', async () => {
    const { db } = handle;
    const row = await db.select().from(sites).where(eq(sites.id, siteId));
    expect(row[0]?.slug).toBe('parent-site');
    expect(row[0]?.healthScore).toBe(100);
    expect(row[0]?.status).toBe('active');
  });

  it('domains: insert + read', async () => {
    const { db } = handle;
    const [d] = await db
      .insert(domains)
      .values({ siteId, domain: 'example.com', isPrimary: true })
      .returning();
    expect(d?.domain).toBe('example.com');
  });

  it('deployments: insert + read', async () => {
    const { db } = handle;
    const [d] = await db
      .insert(deployments)
      .values({
        siteId,
        provider: 'cloudflare_pages',
        status: 'success',
        commitSha: 'abc123',
        triggeredBy: 'human',
      })
      .returning();
    expect(d?.status).toBe('success');
  });

  it('uptime_checks: insert + read (bigserial)', async () => {
    const { db } = handle;
    const [u] = await db
      .insert(uptimeChecks)
      .values({
        siteId,
        checkedAt: new Date(),
        url: 'https://example.com',
        statusCode: 200,
        responseTimeMs: 120,
        ok: true,
      })
      .returning();
    expect(typeof u?.id).toBe('bigint');
    expect(u?.ok).toBe(true);
  });

  it('audit_runs: insert + read', async () => {
    const { db } = handle;
    const row = await db.select().from(auditRuns).where(eq(auditRuns.id, auditRunId));
    expect(row[0]?.score).toBe(88);
  });

  it('audit_findings: insert + read', async () => {
    const { db } = handle;
    const [f] = await db
      .insert(auditFindings)
      .values({
        auditRunId,
        siteId,
        severity: 'warning',
        code: 'seo.missing_meta_description',
        title: 'Missing meta description',
      })
      .returning();
    expect(f?.severity).toBe('warning');
  });

  it('metrics_daily: insert + read', async () => {
    const { db } = handle;
    const [m] = await db
      .insert(metricsDaily)
      .values({
        siteId,
        date: '2026-01-01',
        pv: 1000,
        uv: 800,
        sessions: 900,
        revenueUsd: '12.3456',
      })
      .returning();
    expect(m?.pv).toBe(1000);
    expect(m?.revenueUsd).toBe('12.3456');
  });

  it('search_console_daily: insert + read', async () => {
    const { db } = handle;
    const [s] = await db
      .insert(searchConsoleDaily)
      .values({
        siteId,
        date: '2026-01-01',
        query: 'siteops',
        country: 'US',
        device: 'desktop',
        clicks: 5,
        impressions: 50,
        ctr: '0.1000',
        position: '7.50',
      })
      .returning();
    expect(s?.query).toBe('siteops');
  });

  it('adsense_daily: insert + read', async () => {
    const { db } = handle;
    const [a] = await db
      .insert(adsenseDaily)
      .values({
        siteId,
        date: '2026-01-01',
        earningsUsd: '4.5600',
        pageViews: 1234,
        impressions: 2345,
        clicks: 12,
      })
      .returning();
    expect(a?.earningsUsd).toBe('4.5600');
  });

  it('errors: insert + read', async () => {
    const { db } = handle;
    const [e] = await db
      .insert(errors)
      .values({
        siteId,
        source: 'js',
        level: 'error',
        fingerprint: 'fp-1',
        message: 'TypeError: x is not a function',
        meta: { url: 'https://example.com/page' },
      })
      .returning();
    expect(e?.fingerprint).toBe('fp-1');
    expect(e?.count).toBe(1);
  });

  it('alert_channels: insert + read', async () => {
    const { db } = handle;
    const [c] = await db
      .insert(alertChannels)
      .values({
        name: 'ops-webhook',
        type: 'webhook',
        config: { url: 'https://hooks.example.com/x' },
      })
      .returning();
    expect(c?.enabled).toBe(true);
  });

  it('alert_rules: insert + read', async () => {
    const { db } = handle;
    const row = await db.select().from(alertRules).where(eq(alertRules.id, alertRuleId));
    expect(row[0]?.metric).toBe('uptime');
  });

  it('alerts: insert + read', async () => {
    const { db } = handle;
    const [a] = await db
      .insert(alerts)
      .values({
        ruleId: alertRuleId,
        siteId,
        status: 'firing',
        value: '0.95',
        message: 'uptime below 0.99',
      })
      .returning();
    expect(a?.status).toBe('firing');
  });

  it('jobs_log: insert + read', async () => {
    const { db } = handle;
    const [j] = await db
      .insert(jobsLog)
      .values({
        queue: 'uptime',
        jobName: 'check',
        jobId: 'bullmq:1',
        status: 'success',
        attempts: 1,
        durationMs: 250,
      })
      .returning();
    expect(j?.status).toBe('success');
  });

  it('agent_runs: insert + read', async () => {
    const { db } = handle;
    const [a] = await db
      .insert(agentRuns)
      .values({
        apiKeyId,
        agentName: 'trend-agent',
        action: 'ideas.propose',
        status: 'success',
        durationMs: 1234,
        input: { topic: 'devtools' },
        output: { ideas: 3 },
      })
      .returning();
    expect(a?.action).toBe('ideas.propose');
  });

  it('updated_at trigger: bumps timestamp on update (users)', async () => {
    const { db } = handle;
    const [u] = await db
      .insert(users)
      .values({
        email: 'trigger@example.com',
        passwordHash: 'bcrypt$placeholder',
      })
      .returning();
    const before = u!.updatedAt;

    // PG `now()` is per-transaction; sleep so the timestamp can actually advance.
    await new Promise((r) => setTimeout(r, 50));

    const [updated] = await db
      .update(users)
      .set({ name: 'Renamed' })
      .where(eq(users.id, u!.id))
      .returning();
    expect(updated?.updatedAt.getTime()).toBeGreaterThan(before.getTime());
  });
});
