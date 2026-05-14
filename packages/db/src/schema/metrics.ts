import {
  bigserial,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { createdAt } from './_helpers.js';
import { sites } from './sites.js';

/** Per-site daily aggregate (one row per site per day). */
export const metricsDaily = pgTable(
  'metrics_daily',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id),
    date: date('date', { mode: 'string' }).notNull(),
    pv: integer('pv').notNull().default(0),
    uv: integer('uv').notNull().default(0),
    sessions: integer('sessions').notNull().default(0),
    bounceRate: numeric('bounce_rate', { precision: 5, scale: 4 }),
    avgSessionSec: integer('avg_session_sec'),
    revenueUsd: numeric('revenue_usd', { precision: 10, scale: 4 }),
    adRevenueUsd: numeric('ad_revenue_usd', { precision: 10, scale: 4 }),
    affiliateRevenueUsd: numeric('affiliate_revenue_usd', { precision: 10, scale: 4 }),
    uptimePct: numeric('uptime_pct', { precision: 5, scale: 4 }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('metrics_daily_site_date_uk').on(t.siteId, t.date),
    index('metrics_daily_date_idx').on(t.date),
  ],
);

export type MetricDaily = typeof metricsDaily.$inferSelect;
export type NewMetricDaily = typeof metricsDaily.$inferInsert;

/**
 * GSC daily rows. Dimensional columns (query/country/device) are nullable so
 * that aggregate rows (NULL = "total") can coexist with detail rows.
 *
 * The unique index uses `coalesce(...)` to treat NULL as a sentinel value,
 * because Postgres treats two NULLs as distinct in a plain UNIQUE.
 */
export const searchConsoleDaily = pgTable(
  'search_console_daily',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id),
    date: date('date', { mode: 'string' }).notNull(),
    query: text('query'),
    country: text('country'),
    device: text('device'),
    clicks: integer('clicks').notNull().default(0),
    impressions: integer('impressions').notNull().default(0),
    ctr: numeric('ctr', { precision: 5, scale: 4 }),
    position: numeric('position', { precision: 6, scale: 2 }),
  },
  (t) => [
    uniqueIndex('search_console_daily_uk').on(t.siteId, t.date, t.query, t.country, t.device),
    index('search_console_daily_site_date_idx').on(t.siteId, t.date),
  ],
);

export type SearchConsoleDaily = typeof searchConsoleDaily.$inferSelect;
export type NewSearchConsoleDaily = typeof searchConsoleDaily.$inferInsert;

export const adsenseDaily = pgTable(
  'adsense_daily',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id),
    date: date('date', { mode: 'string' }).notNull(),
    earningsUsd: numeric('earnings_usd', { precision: 10, scale: 4 }).notNull().default('0'),
    pageViews: integer('page_views').notNull().default(0),
    impressions: integer('impressions').notNull().default(0),
    clicks: integer('clicks').notNull().default(0),
    rpm: numeric('rpm', { precision: 10, scale: 4 }),
    ctr: numeric('ctr', { precision: 5, scale: 4 }),
  },
  (t) => [uniqueIndex('adsense_daily_site_date_uk').on(t.siteId, t.date)],
);

export type AdsenseDaily = typeof adsenseDaily.$inferSelect;
export type NewAdsenseDaily = typeof adsenseDaily.$inferInsert;
