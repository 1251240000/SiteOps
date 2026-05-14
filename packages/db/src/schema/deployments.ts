import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { createdAt } from './_helpers.js';
import { sites } from './sites.js';

export const DEPLOYMENT_PROVIDERS = [
  'cloudflare_pages',
  'github_pages',
  'vercel',
  'netlify',
  'manual',
] as const;
export type DeploymentProvider = (typeof DEPLOYMENT_PROVIDERS)[number];

export const DEPLOYMENT_STATUS = ['queued', 'building', 'success', 'failed', 'cancelled'] as const;
export type DeploymentStatus = (typeof DEPLOYMENT_STATUS)[number];

export const DEPLOYMENT_TRIGGERS = ['human', 'git_push', 'agent', 'schedule'] as const;
export type DeploymentTrigger = (typeof DEPLOYMENT_TRIGGERS)[number];

export const deployments = pgTable(
  'deployments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id),
    provider: text('provider').$type<DeploymentProvider>(),
    providerDeploymentId: text('provider_deployment_id'),
    commitSha: text('commit_sha'),
    commitMessage: text('commit_message'),
    branch: text('branch'),
    status: text('status').notNull().$type<DeploymentStatus>(),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
    durationMs: integer('duration_ms'),
    buildLogUrl: text('build_log_url'),
    triggeredBy: text('triggered_by').$type<DeploymentTrigger>(),
    createdAt: createdAt(),
  },
  (t) => [
    index('deployments_site_started_idx').on(t.siteId, t.startedAt.desc()),
    index('deployments_status_idx').on(t.status),
    // Idempotency key for upstream platforms — the same `provider` +
    // `provider_deployment_id` always references the same row, regardless of
    // how many times the agent re-POSTs the event. Partial so manual entries
    // (which leave `provider_deployment_id` NULL) don't collide.
    uniqueIndex('deployments_provider_remote_uk')
      .on(t.provider, t.providerDeploymentId)
      .where(sql`${t.provider} IS NOT NULL AND ${t.providerDeploymentId} IS NOT NULL`),
    check(
      'deployments_provider_check',
      sql`${t.provider} IS NULL OR ${t.provider} IN ('cloudflare_pages','github_pages','vercel','netlify','manual')`,
    ),
    check(
      'deployments_status_check',
      sql`${t.status} IN ('queued','building','success','failed','cancelled')`,
    ),
    check(
      'deployments_triggered_by_check',
      sql`${t.triggeredBy} IS NULL OR ${t.triggeredBy} IN ('human','git_push','agent','schedule')`,
    ),
  ],
);

export type Deployment = typeof deployments.$inferSelect;
export type NewDeployment = typeof deployments.$inferInsert;
