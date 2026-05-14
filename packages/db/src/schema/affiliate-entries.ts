import { sql } from 'drizzle-orm';
import { check, date, index, numeric, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { createdAt, updatedAt } from './_helpers.js';
import { sites } from './sites.js';

/**
 * Manual affiliate / one-off revenue entries.
 *
 * Each row represents revenue earned by a site over a span (`period_start`
 * .. `period_end`, both inclusive). The MVP intentionally does **not**
 * enforce uniqueness on `(site_id, program, period)` — operators may
 * legitimately split a payout into multiple entries (e.g. one per traffic
 * source) and we want the UI to be permissive. Aggregation lives in the
 * service layer.
 *
 * `amount_usd` is the canonical currency the dashboard sums; `amount_raw`
 * + `currency` are kept as bookkeeping fields so the original payout can
 * be cross-checked against the affiliate platform without round-tripping
 * through an FX service we don't run.
 */
export const affiliateEntries = pgTable(
  'affiliate_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    periodStart: date('period_start', { mode: 'string' }).notNull(),
    periodEnd: date('period_end', { mode: 'string' }).notNull(),
    program: text('program').notNull(),
    amountUsd: numeric('amount_usd', { precision: 10, scale: 4 }).notNull(),
    amountRaw: numeric('amount_raw', { precision: 10, scale: 4 }),
    currency: text('currency'),
    payoutDate: date('payout_date', { mode: 'string' }),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('affiliate_entries_site_period_idx').on(t.siteId, t.periodStart, t.periodEnd),
    index('affiliate_entries_period_idx').on(t.periodStart, t.periodEnd),
    check('affiliate_entries_period_chk', sql`${t.periodEnd} >= ${t.periodStart}`),
    check('affiliate_entries_amount_chk', sql`${t.amountUsd} >= 0`),
  ],
);

export type AffiliateEntry = typeof affiliateEntries.$inferSelect;
export type NewAffiliateEntry = typeof affiliateEntries.$inferInsert;
