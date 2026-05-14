/**
 * Affiliate entries repository.
 *
 * Thin CRUD around `affiliate_entries`. The interesting work — splitting an
 * entry across the days it spans, joining with AdSense, computing deltas —
 * lives in `revenueService`. This module only exposes:
 *
 *   - `create` / `update` / `delete`
 *   - `getById` / `listForSite`
 *   - `listOverlapping(range, siteId?)` — the only "smart" query, used by
 *     the service to fetch every row whose `[period_start, period_end]`
 *     intersects an inclusive `[from, to]` window. The service then
 *     spreads the amount across days as required by the T23 spec.
 *
 * `listKnownPrograms(siteId, sinceDays)` powers the autocomplete the UI
 * shows on the create form (90-day rolling list of programs the site has
 * used before).
 */
import { and, asc, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm';

import type { Db } from '../client.js';
import {
  affiliateEntries,
  type AffiliateEntry,
  type NewAffiliateEntry,
} from '../schema/affiliate-entries.js';

function strNum(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) return null;
  return value.toString();
}

export type AffiliateEntryCreate = {
  siteId: string;
  periodStart: string;
  periodEnd: string;
  program: string;
  amountUsd: number;
  amountRaw?: number | null;
  currency?: string | null;
  payoutDate?: string | null;
  notes?: string | null;
};

export type AffiliateEntryPatch = Partial<Omit<AffiliateEntryCreate, 'siteId'>>;

export const affiliateEntryRepo = {
  async create(db: Db, input: AffiliateEntryCreate): Promise<AffiliateEntry> {
    const insert: NewAffiliateEntry = {
      siteId: input.siteId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      program: input.program,
      amountUsd: strNum(input.amountUsd) ?? '0',
      amountRaw: strNum(input.amountRaw ?? null),
      currency: input.currency ?? null,
      payoutDate: input.payoutDate ?? null,
      notes: input.notes ?? null,
    };
    const rows = await db.insert(affiliateEntries).values(insert).returning();
    const row = rows[0];
    if (!row) throw new Error('affiliateEntryRepo.create: insert returned no row');
    return row;
  },

  async getById(db: Db, id: string): Promise<AffiliateEntry | null> {
    const rows = await db
      .select()
      .from(affiliateEntries)
      .where(eq(affiliateEntries.id, id))
      .limit(1);
    return rows[0] ?? null;
  },

  async update(db: Db, id: string, patch: AffiliateEntryPatch): Promise<AffiliateEntry | null> {
    const set: Partial<NewAffiliateEntry> = {};
    if (patch.periodStart !== undefined) set.periodStart = patch.periodStart;
    if (patch.periodEnd !== undefined) set.periodEnd = patch.periodEnd;
    if (patch.program !== undefined) set.program = patch.program;
    if (patch.amountUsd !== undefined) set.amountUsd = strNum(patch.amountUsd) ?? '0';
    if (patch.amountRaw !== undefined) set.amountRaw = strNum(patch.amountRaw ?? null);
    if (patch.currency !== undefined) set.currency = patch.currency ?? null;
    if (patch.payoutDate !== undefined) set.payoutDate = patch.payoutDate ?? null;
    if (patch.notes !== undefined) set.notes = patch.notes ?? null;
    if (Object.keys(set).length === 0) {
      return this.getById(db, id);
    }
    const rows = await db
      .update(affiliateEntries)
      .set(set)
      .where(eq(affiliateEntries.id, id))
      .returning();
    return rows[0] ?? null;
  },

  async delete(db: Db, id: string): Promise<boolean> {
    const rows = await db
      .delete(affiliateEntries)
      .where(eq(affiliateEntries.id, id))
      .returning({ id: affiliateEntries.id });
    return rows.length > 0;
  },

  /** Most recent entries for a site, newest first. */
  async listForSite(
    db: Db,
    siteId: string,
    opts: { limit?: number } = {},
  ): Promise<AffiliateEntry[]> {
    const limit = Math.min(500, Math.max(1, opts.limit ?? 100));
    return db
      .select()
      .from(affiliateEntries)
      .where(eq(affiliateEntries.siteId, siteId))
      .orderBy(desc(affiliateEntries.periodStart), desc(affiliateEntries.createdAt))
      .limit(limit);
  },

  /**
   * Every entry whose period overlaps `[from, to]` (inclusive). Optional
   * `siteId` narrows to one site. Used by the revenue service to drive
   * "spread across days" aggregation.
   */
  async listOverlapping(
    db: Db,
    range: { from: string; to: string },
    siteId?: string,
  ): Promise<AffiliateEntry[]> {
    const clauses: SQL[] = [
      lte(affiliateEntries.periodStart, range.to),
      gte(affiliateEntries.periodEnd, range.from),
    ];
    if (siteId) clauses.push(eq(affiliateEntries.siteId, siteId));
    const where = clauses.length === 1 ? clauses[0] : and(...clauses);
    return db
      .select()
      .from(affiliateEntries)
      .where(where)
      .orderBy(asc(affiliateEntries.periodStart));
  },

  /**
   * Distinct programs used by a site within the last `sinceDays`. Powers
   * the create-entry form's autocomplete; cap at 50 entries so the
   * dropdown stays usable.
   */
  async listKnownPrograms(db: Db, siteId: string, sinceDays = 90): Promise<string[]> {
    const days = Math.max(1, Math.floor(sinceDays));
    const rows = await db
      .selectDistinct({ program: affiliateEntries.program })
      .from(affiliateEntries)
      .where(
        and(
          eq(affiliateEntries.siteId, siteId),
          sql`${affiliateEntries.periodEnd} >= (CURRENT_DATE - ${sql.raw(`${days}`)} * INTERVAL '1 day')`,
        ),
      )
      .limit(50);
    return rows.map((r) => r.program).filter((p) => typeof p === 'string' && p.length > 0);
  },
};
