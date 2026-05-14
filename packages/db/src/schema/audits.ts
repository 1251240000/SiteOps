import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { createdAt } from './_helpers.js';
import { sites } from './sites.js';

export const AUDIT_TYPES = ['seo', 'lighthouse', 'links', 'compliance'] as const;
export type AuditType = (typeof AUDIT_TYPES)[number];

export const AUDIT_STATUS = ['running', 'success', 'failed'] as const;
export type AuditStatus = (typeof AUDIT_STATUS)[number];

export const FINDING_SEVERITY = ['info', 'warning', 'error', 'critical'] as const;
export type FindingSeverity = (typeof FINDING_SEVERITY)[number];

export const auditRuns = pgTable(
  'audit_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id),
    auditType: text('audit_type').notNull().$type<AuditType>(),
    status: text('status').$type<AuditStatus>(),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
    score: smallint('score'),
    summary: jsonb('summary').$type<Record<string, unknown>>(),
    rawReportPath: text('raw_report_path'),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_runs_site_started_idx').on(t.siteId, t.startedAt.desc()),
    index('audit_runs_type_idx').on(t.auditType),
    check(
      'audit_runs_type_check',
      sql`${t.auditType} IN ('seo','lighthouse','links','compliance')`,
    ),
    check(
      'audit_runs_status_check',
      sql`${t.status} IS NULL OR ${t.status} IN ('running','success','failed')`,
    ),
    check(
      'audit_runs_score_range',
      sql`${t.score} IS NULL OR (${t.score} >= 0 AND ${t.score} <= 100)`,
    ),
  ],
);

export type AuditRun = typeof auditRuns.$inferSelect;
export type NewAuditRun = typeof auditRuns.$inferInsert;

export const auditFindings = pgTable(
  'audit_findings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    auditRunId: uuid('audit_run_id')
      .notNull()
      .references(() => auditRuns.id),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id),
    severity: text('severity').notNull().$type<FindingSeverity>(),
    code: text('code').notNull(),
    title: text('title').notNull(),
    message: text('message'),
    url: text('url'),
    meta: jsonb('meta').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_findings_site_severity_idx').on(t.siteId, t.severity),
    index('audit_findings_code_idx').on(t.code),
    index('audit_findings_run_idx').on(t.auditRunId),
    check(
      'audit_findings_severity_check',
      sql`${t.severity} IN ('info','warning','error','critical')`,
    ),
  ],
);

export type AuditFinding = typeof auditFindings.$inferSelect;
export type NewAuditFinding = typeof auditFindings.$inferInsert;
