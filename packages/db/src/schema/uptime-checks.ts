import {
  bigserial,
  boolean,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { sites } from './sites.js';

/**
 * High-volume time series. Retention: 90 days raw, then archive/aggregate into
 * `metrics_daily.uptime_pct`. Uses bigserial for sequential write throughput.
 */
export const uptimeChecks = pgTable(
  'uptime_checks',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id),
    checkedAt: timestamp('checked_at', { withTimezone: true, mode: 'date' }).notNull(),
    url: text('url').notNull(),
    statusCode: smallint('status_code'),
    responseTimeMs: integer('response_time_ms'),
    ok: boolean('ok').notNull(),
    error: text('error'),
    region: text('region').notNull().default('local'),
  },
  (t) => [index('uptime_checks_site_checked_idx').on(t.siteId, t.checkedAt.desc())],
);

export type UptimeCheck = typeof uptimeChecks.$inferSelect;
export type NewUptimeCheck = typeof uptimeChecks.$inferInsert;
