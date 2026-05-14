/**
 * Site costs repository.
 *
 * Thin CRUD around `site_costs`. The cost-amortisation logic — splitting
 * a month's total into per-day costs that overlap the request window —
 * lives in `roiService`; this module only exposes the storage primitives:
 *
 *   - `create` / `update` / `delete`
 *   - `getById` / `listForSite`
 *   - `listOverlapping(range, siteId?)` — every row whose covered month
 *     intersects an inclusive `[from, to]` window. The service then
 *     spreads each month's total across the days inside the window.
 *
 * The `(site_id, month)` unique index means `create` will throw on a
 * duplicate, which the service translates into a 409 — operators are
 * expected to edit the existing row rather than insert a second one for
 * the same month.
 */
import { and, asc, desc, eq, lte, sql, type SQL } from 'drizzle-orm';

import type { Db } from '../client.js';
import { siteCosts, type NewSiteCost, type SiteCost } from '../schema/site-costs.js';

function strNum(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) return null;
  return value.toString();
}

export type SiteCostCreate = {
  siteId: string;
  /** First day of the month, e.g. `2026-03-01`. */
  month: string;
  hostingUsd?: number;
  domainUsd?: number;
  contentUsd?: number;
  adsSpendUsd?: number;
  otherUsd?: number;
  notes?: string | null;
};

export type SiteCostPatch = Partial<Omit<SiteCostCreate, 'siteId'>>;

/**
 * `EXTRACT(DAY FROM month)` returns the day-of-month; the schema-level
 * CHECK already enforces it equals 1, but we re-validate at the repo
 * boundary so a malformed write never reaches Postgres (the error
 * message at the repo layer is friendlier than the raw constraint
 * violation).
 */
function assertFirstOfMonth(month: string): void {
  if (!/^\d{4}-\d{2}-01$/.test(month)) {
    throw new Error(
      `siteCostRepo: \`month\` must be the first day of a month (YYYY-MM-01); got "${month}"`,
    );
  }
}

export const siteCostRepo = {
  async create(db: Db, input: SiteCostCreate): Promise<SiteCost> {
    assertFirstOfMonth(input.month);
    const insert: NewSiteCost = {
      siteId: input.siteId,
      month: input.month,
      hostingUsd: strNum(input.hostingUsd ?? 0) ?? '0',
      domainUsd: strNum(input.domainUsd ?? 0) ?? '0',
      contentUsd: strNum(input.contentUsd ?? 0) ?? '0',
      adsSpendUsd: strNum(input.adsSpendUsd ?? 0) ?? '0',
      otherUsd: strNum(input.otherUsd ?? 0) ?? '0',
      notes: input.notes ?? null,
    };
    const rows = await db.insert(siteCosts).values(insert).returning();
    const row = rows[0];
    if (!row) throw new Error('siteCostRepo.create: insert returned no row');
    return row;
  },

  async getById(db: Db, id: string): Promise<SiteCost | null> {
    const rows = await db.select().from(siteCosts).where(eq(siteCosts.id, id)).limit(1);
    return rows[0] ?? null;
  },

  /** Look up the row for a specific `(site, month)` pair, if any. */
  async getByMonth(db: Db, siteId: string, month: string): Promise<SiteCost | null> {
    assertFirstOfMonth(month);
    const rows = await db
      .select()
      .from(siteCosts)
      .where(and(eq(siteCosts.siteId, siteId), eq(siteCosts.month, month)))
      .limit(1);
    return rows[0] ?? null;
  },

  async update(db: Db, id: string, patch: SiteCostPatch): Promise<SiteCost | null> {
    if (patch.month !== undefined) assertFirstOfMonth(patch.month);
    const set: Partial<NewSiteCost> = {};
    if (patch.month !== undefined) set.month = patch.month;
    if (patch.hostingUsd !== undefined) set.hostingUsd = strNum(patch.hostingUsd) ?? '0';
    if (patch.domainUsd !== undefined) set.domainUsd = strNum(patch.domainUsd) ?? '0';
    if (patch.contentUsd !== undefined) set.contentUsd = strNum(patch.contentUsd) ?? '0';
    if (patch.adsSpendUsd !== undefined) set.adsSpendUsd = strNum(patch.adsSpendUsd) ?? '0';
    if (patch.otherUsd !== undefined) set.otherUsd = strNum(patch.otherUsd) ?? '0';
    if (patch.notes !== undefined) set.notes = patch.notes ?? null;
    if (Object.keys(set).length === 0) {
      return this.getById(db, id);
    }
    const rows = await db.update(siteCosts).set(set).where(eq(siteCosts.id, id)).returning();
    return rows[0] ?? null;
  },

  async delete(db: Db, id: string): Promise<boolean> {
    const rows = await db
      .delete(siteCosts)
      .where(eq(siteCosts.id, id))
      .returning({ id: siteCosts.id });
    return rows.length > 0;
  },

  /** Most recent rows for a site, newest month first. */
  async listForSite(db: Db, siteId: string, opts: { limit?: number } = {}): Promise<SiteCost[]> {
    const limit = Math.min(500, Math.max(1, opts.limit ?? 24));
    return db
      .select()
      .from(siteCosts)
      .where(eq(siteCosts.siteId, siteId))
      .orderBy(desc(siteCosts.month))
      .limit(limit);
  },

  /**
   * Every row whose covered month intersects `[from, to]`. A row's
   * "covered month" runs from `month` (the 1st) through the last day of
   * that month, so the precise overlap test is:
   *
   *   `month <= to`  AND  `month + 1 month > from`
   *
   * (the first day of the next month must lie strictly after `from`).
   * Optional `siteId` narrows to one site.
   */
  async listOverlapping(
    db: Db,
    range: { from: string; to: string },
    siteId?: string,
  ): Promise<SiteCost[]> {
    const clauses: SQL[] = [
      lte(siteCosts.month, range.to),
      sql`(${siteCosts.month} + INTERVAL '1 month') > ${range.from}::date`,
    ];
    if (siteId) clauses.push(eq(siteCosts.siteId, siteId));
    const where = clauses.length === 1 ? clauses[0] : and(...clauses);
    return db.select().from(siteCosts).where(where).orderBy(asc(siteCosts.month));
  },
};
