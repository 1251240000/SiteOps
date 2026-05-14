import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { createdAt } from './_helpers.js';
import { sites } from './sites.js';

export const ALERT_SCOPES = ['global', 'site'] as const;
export type AlertScope = (typeof ALERT_SCOPES)[number];

export const ALERT_METRICS = [
  'uptime',
  'ssl_expiry',
  'domain_expiry',
  'lighthouse_perf',
  'error_rate',
  'custom',
] as const;
export type AlertMetric = (typeof ALERT_METRICS)[number];

export const ALERT_OPERATORS = ['lt', 'lte', 'gt', 'gte', 'eq'] as const;
export type AlertOperator = (typeof ALERT_OPERATORS)[number];

export const ALERT_CHANNEL_TYPES = [
  'webhook',
  'email',
  'feishu',
  'dingtalk',
  'slack',
  'telegram',
] as const;
export type AlertChannelType = (typeof ALERT_CHANNEL_TYPES)[number];

export const ALERT_STATUS = ['firing', 'resolved'] as const;
export type AlertStatus = (typeof ALERT_STATUS)[number];

export const alertChannels = pgTable(
  'alert_channels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    type: text('type').notNull().$type<AlertChannelType>(),
    /** Channel-specific config (webhook URL, email recipients, etc.); MUST be encrypted by service layer. */
    config: jsonb('config').notNull().$type<Record<string, unknown>>(),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'alert_channels_type_check',
      sql`${t.type} IN ('webhook','email','feishu','dingtalk','slack','telegram')`,
    ),
  ],
);

export type AlertChannel = typeof alertChannels.$inferSelect;
export type NewAlertChannel = typeof alertChannels.$inferInsert;

export const alertRules = pgTable(
  'alert_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    scope: text('scope').notNull().$type<AlertScope>(),
    siteId: uuid('site_id').references(() => sites.id),
    metric: text('metric').notNull().$type<AlertMetric>(),
    operator: text('operator').notNull().$type<AlertOperator>(),
    threshold: numeric('threshold').notNull(),
    windowMinutes: smallint('window_minutes'),
    consecutive: smallint('consecutive').notNull().default(1),
    enabled: boolean('enabled').notNull().default(true),
    /** Array of `alert_channels.id`. Validated at app layer (no FK on array members). */
    channelIds: uuid('channel_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    createdAt: createdAt(),
  },
  (t) => [
    index('alert_rules_site_idx').on(t.siteId),
    check('alert_rules_scope_check', sql`${t.scope} IN ('global','site')`),
    check(
      'alert_rules_metric_check',
      sql`${t.metric} IN ('uptime','ssl_expiry','domain_expiry','lighthouse_perf','error_rate','custom')`,
    ),
    check('alert_rules_operator_check', sql`${t.operator} IN ('lt','lte','gt','gte','eq')`),
    check(
      'alert_rules_scope_site_consistency',
      sql`(${t.scope} = 'global' AND ${t.siteId} IS NULL) OR (${t.scope} = 'site' AND ${t.siteId} IS NOT NULL)`,
    ),
  ],
);

export type AlertRule = typeof alertRules.$inferSelect;
export type NewAlertRule = typeof alertRules.$inferInsert;

export type AlertChannelDelivery = {
  channel_id: string;
  sent_at: string;
  ok: boolean;
  error?: string;
};

export const alerts = pgTable(
  'alerts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ruleId: uuid('rule_id')
      .notNull()
      .references(() => alertRules.id),
    siteId: uuid('site_id').references(() => sites.id),
    status: text('status').notNull().$type<AlertStatus>(),
    value: numeric('value'),
    message: text('message'),
    firedAt: timestamp('fired_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'date' }),
    notifiedChannels: jsonb('notified_channels').$type<AlertChannelDelivery[]>(),
  },
  (t) => [
    index('alerts_status_idx').on(t.status),
    index('alerts_site_fired_idx').on(t.siteId, t.firedAt.desc()),
    index('alerts_rule_idx').on(t.ruleId),
    check('alerts_status_check', sql`${t.status} IN ('firing','resolved')`),
  ],
);

export type Alert = typeof alerts.$inferSelect;
export type NewAlert = typeof alerts.$inferInsert;
