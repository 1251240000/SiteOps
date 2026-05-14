import { sql } from 'drizzle-orm';
import { check, date, index, numeric, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { createdAt, updatedAt } from './_helpers.js';
import { sites } from './sites.js';

/**
 * Monthly site costs. One row per `(site_id, month)` so the unique index
 * doubles as the upsert key. The columns model how operators actually
 * think about cost:
 *
 *   - hosting    — Pages / serverless / CDN / DB
 *   - domain     — annual fee amortised to whichever month it was paid
 *   - content    — copy / outsourced articles
 *   - ads_spend  — paid traffic acquisition
 *   - other      — everything else (tools, designers, …)
 *
 * `month` must always be the first day of its month — the CHECK
 * constraint guards that. The ROI service averages each month's total
 * across the days it covers, so any column granularity below "month" is
 * intentionally out of scope for M4.
 */
export const siteCosts = pgTable(
  'site_costs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    month: date('month', { mode: 'string' }).notNull(),
    hostingUsd: numeric('hosting_usd', { precision: 10, scale: 4 }).notNull().default('0'),
    domainUsd: numeric('domain_usd', { precision: 10, scale: 4 }).notNull().default('0'),
    contentUsd: numeric('content_usd', { precision: 10, scale: 4 }).notNull().default('0'),
    adsSpendUsd: numeric('ads_spend_usd', { precision: 10, scale: 4 }).notNull().default('0'),
    otherUsd: numeric('other_usd', { precision: 10, scale: 4 }).notNull().default('0'),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('site_costs_site_month_uk').on(t.siteId, t.month),
    index('site_costs_month_idx').on(t.month),
    check('site_costs_month_first_day_chk', sql`EXTRACT(DAY FROM ${t.month}) = 1`),
    check(
      'site_costs_amounts_chk',
      sql`${t.hostingUsd} >= 0 AND ${t.domainUsd} >= 0 AND ${t.contentUsd} >= 0 AND ${t.adsSpendUsd} >= 0 AND ${t.otherUsd} >= 0`,
    ),
  ],
);

export type SiteCost = typeof siteCosts.$inferSelect;
export type NewSiteCost = typeof siteCosts.$inferInsert;
