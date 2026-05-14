/**
 * Revenue service.
 *
 * Joins two data sources into a single "revenue" view that the dashboard
 * (and downstream agents) can consume without knowing the storage layout:
 *
 *   - `adsense_daily.earnings_usd` — automated, day-precision (T21 ingest)
 *   - `affiliate_entries.amount_usd` — manual, period-of-N-days (T23)
 *
 * The trick is the manual side: an operator types in *one* row covering a
 * span (e.g. "March 1 → March 31, $123.45"), and the chart needs to spread
 * that amount evenly across the days the row covers (the spec calls this
 * `attribution: 'spread'`). All time-bucket maths happens in JS so the SQL
 * queries stay portable; the AdSense side stays pure SQL because it is
 * already row-per-day.
 *
 * `revenue-service.ts` is the *only* place that knows about the spread
 * rule — `roiService` (T24) will consume the same surface.
 */
import { affiliateEntryRepo, adsenseDaily, type AffiliateEntry, type Db, sites } from '@siteops/db';
import {
  AppError,
  type CreateAffiliateEntryInput,
  type UpdateAffiliateEntryInput,
  addDays,
  createAffiliateEntrySchema,
  enumerateBuckets,
  fillDateRange,
  formatIsoDate,
  parseIsoDate,
  startOfIsoWeek,
  updateAffiliateEntrySchema,
  type Granularity,
  type Logger,
} from '@siteops/shared';
import { and, between, eq, inArray, sql } from 'drizzle-orm';

export type DateRange = {
  /** Inclusive `YYYY-MM-DD` (UTC). */
  from: string;
  /** Inclusive `YYYY-MM-DD` (UTC). */
  to: string;
};

export type RevenueSummary = {
  adRevenue: number;
  affiliateRevenue: number;
  total: number;
  totalPrev: number;
  /** Decimal change ratio (current − prev) / prev, 0 when prev=0. */
  delta: number;
  /** Highest-grossing affiliate program in the window, or null. */
  topProgram: string | null;
};

export type RevenuePoint = {
  date: string;
  adRevenue: number;
  affiliateRevenue: number;
};

export type RevenueSeriesResponse = {
  points: RevenuePoint[];
  granularity: Granularity;
};

export type TopRevenueSiteRow = {
  siteId: string;
  slug: string;
  name: string;
  adRevenue: number;
  affiliateRevenue: number;
  total: number;
};

export type RevenueServiceDeps = {
  db: Db;
  logger?: Pick<Logger, 'info' | 'warn'>;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Round to 4 decimals (matches `numeric(10,4)` storage precision). */
function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function rangeDays(range: DateRange): number {
  const fromTs = Date.parse(`${range.from}T00:00:00.000Z`);
  const toTs = Date.parse(`${range.to}T00:00:00.000Z`);
  return Math.floor((toTs - fromTs) / MS_PER_DAY) + 1;
}

function previousRange(range: DateRange): DateRange {
  const days = rangeDays(range);
  const prevTo = addDays(range.from, -1);
  const prevFrom = addDays(prevTo, -(days - 1));
  return { from: prevFrom, to: prevTo };
}

function clampToRange(date: string, range: DateRange): string | null {
  const t = Date.parse(`${date}T00:00:00.000Z`);
  const fromTs = Date.parse(`${range.from}T00:00:00.000Z`);
  const toTs = Date.parse(`${range.to}T00:00:00.000Z`);
  if (t < fromTs || t > toTs) return null;
  return date;
}

/**
 * Spread an entry's `amount_usd` across the days of its period (intersected
 * with the request window). Returns a `Map<dateKey, dollars>` for those
 * days only.
 *
 * The bucket key is either the day itself (`granularity='day'`) or the
 * Monday of its ISO week (`granularity='week'`), matching how
 * `getAdSenseSeries` aggregates the AdSense side.
 */
function spreadEntryToBuckets(
  entry: AffiliateEntry,
  range: DateRange,
  granularity: Granularity,
): Map<string, number> {
  const totalDays =
    Math.floor(
      (Date.parse(`${entry.periodEnd}T00:00:00.000Z`) -
        Date.parse(`${entry.periodStart}T00:00:00.000Z`)) /
        MS_PER_DAY,
    ) + 1;
  if (totalDays <= 0) return new Map();
  const perDay = num(entry.amountUsd) / totalDays;
  const out = new Map<string, number>();
  // Walk the entry day by day; only emit those that fall in `range`.
  const startTs = Math.max(
    Date.parse(`${entry.periodStart}T00:00:00.000Z`),
    Date.parse(`${range.from}T00:00:00.000Z`),
  );
  const endTs = Math.min(
    Date.parse(`${entry.periodEnd}T00:00:00.000Z`),
    Date.parse(`${range.to}T00:00:00.000Z`),
  );
  for (let ts = startTs; ts <= endTs; ts += MS_PER_DAY) {
    const day = formatIsoDate(new Date(ts));
    const key = granularity === 'week' ? startOfIsoWeek(day) : day;
    out.set(key, (out.get(key) ?? 0) + perDay);
  }
  return out;
}

/**
 * Sum every overlapping entry's contribution within `range` (no bucketing).
 * Used by the summary endpoints.
 */
function sumAffiliateInRange(entries: readonly AffiliateEntry[], range: DateRange): number {
  let total = 0;
  for (const e of entries) {
    const totalDays =
      Math.floor(
        (Date.parse(`${e.periodEnd}T00:00:00.000Z`) -
          Date.parse(`${e.periodStart}T00:00:00.000Z`)) /
          MS_PER_DAY,
      ) + 1;
    if (totalDays <= 0) continue;
    const perDay = num(e.amountUsd) / totalDays;
    const startTs = Math.max(
      Date.parse(`${e.periodStart}T00:00:00.000Z`),
      Date.parse(`${range.from}T00:00:00.000Z`),
    );
    const endTs = Math.min(
      Date.parse(`${e.periodEnd}T00:00:00.000Z`),
      Date.parse(`${range.to}T00:00:00.000Z`),
    );
    if (endTs < startTs) continue;
    const days = Math.floor((endTs - startTs) / MS_PER_DAY) + 1;
    total += perDay * days;
  }
  return total;
}

function topProgramOf(entries: readonly AffiliateEntry[], range: DateRange): string | null {
  const tally = new Map<string, number>();
  for (const e of entries) {
    const totalDays =
      Math.floor(
        (Date.parse(`${e.periodEnd}T00:00:00.000Z`) -
          Date.parse(`${e.periodStart}T00:00:00.000Z`)) /
          MS_PER_DAY,
      ) + 1;
    if (totalDays <= 0) continue;
    const perDay = num(e.amountUsd) / totalDays;
    const startTs = Math.max(
      Date.parse(`${e.periodStart}T00:00:00.000Z`),
      Date.parse(`${range.from}T00:00:00.000Z`),
    );
    const endTs = Math.min(
      Date.parse(`${e.periodEnd}T00:00:00.000Z`),
      Date.parse(`${range.to}T00:00:00.000Z`),
    );
    if (endTs < startTs) continue;
    const days = Math.floor((endTs - startTs) / MS_PER_DAY) + 1;
    tally.set(e.program, (tally.get(e.program) ?? 0) + perDay * days);
  }
  let best: { program: string; amount: number } | null = null;
  for (const [program, amount] of tally) {
    if (!best || amount > best.amount) best = { program, amount };
  }
  return best?.program ?? null;
}

function deltaRatio(current: number, prev: number): number {
  if (prev === 0) return 0;
  return (current - prev) / prev;
}

// note: ISO week 1=Monday — matches Postgres `date_trunc('week', ...)`.
function bucketKey(date: string, granularity: Granularity): string {
  return granularity === 'week' ? startOfIsoWeek(date) : date;
}

export const revenueService = {
  // ---------- write surface ----------------------------------------------

  async createAffiliateEntry(
    deps: RevenueServiceDeps,
    siteId: string,
    rawInput: unknown,
  ): Promise<AffiliateEntry> {
    const parsed = createAffiliateEntrySchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new AppError('Invalid affiliate entry', {
        code: 'validation_failed',
        status: 400,
        details: parsed.error.flatten(),
      });
    }
    const input: CreateAffiliateEntryInput = parsed.data;
    const created = await affiliateEntryRepo.create(deps.db, {
      siteId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      program: input.program,
      amountUsd: input.amountUsd,
      amountRaw: input.amountRaw ?? null,
      currency: input.currency ?? null,
      payoutDate: input.payoutDate ?? null,
      notes: input.notes ?? null,
    });
    deps.logger?.info(
      { event: 'affiliate.created', entryId: created.id, siteId, program: created.program },
      'affiliate entry created',
    );
    return created;
  },

  async updateAffiliateEntry(
    deps: RevenueServiceDeps,
    id: string,
    rawPatch: unknown,
  ): Promise<AffiliateEntry> {
    const parsed = updateAffiliateEntrySchema.safeParse(rawPatch);
    if (!parsed.success) {
      throw new AppError('Invalid affiliate entry patch', {
        code: 'validation_failed',
        status: 400,
        details: parsed.error.flatten(),
      });
    }
    const patch: UpdateAffiliateEntryInput = parsed.data;
    const updated = await affiliateEntryRepo.update(deps.db, id, {
      ...(patch.periodStart !== undefined ? { periodStart: patch.periodStart } : {}),
      ...(patch.periodEnd !== undefined ? { periodEnd: patch.periodEnd } : {}),
      ...(patch.program !== undefined ? { program: patch.program } : {}),
      ...(patch.amountUsd !== undefined ? { amountUsd: patch.amountUsd } : {}),
      ...(patch.amountRaw !== undefined ? { amountRaw: patch.amountRaw } : {}),
      ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
      ...(patch.payoutDate !== undefined ? { payoutDate: patch.payoutDate } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    });
    if (!updated) {
      throw new AppError('Affiliate entry not found', {
        code: 'not_found',
        status: 404,
        details: { id },
      });
    }
    // updated_at is maintained by the BEFORE UPDATE trigger.
    if (
      updated.updatedAt.getTime() === updated.createdAt.getTime() &&
      Object.keys(patch).length > 0
    ) {
      // PGlite (test) has no triggers; bump manually so the type stays
      // numeric/date-friendly without surprising callers.
      updated.updatedAt = new Date();
    }
    deps.logger?.info(
      { event: 'affiliate.updated', entryId: id, fields: Object.keys(patch) },
      'affiliate entry updated',
    );
    return updated;
  },

  async deleteAffiliateEntry(deps: RevenueServiceDeps, id: string): Promise<void> {
    const removed = await affiliateEntryRepo.delete(deps.db, id);
    if (!removed) {
      throw new AppError('Affiliate entry not found', {
        code: 'not_found',
        status: 404,
        details: { id },
      });
    }
    deps.logger?.info({ event: 'affiliate.deleted', entryId: id }, 'affiliate entry deleted');
  },

  async getAffiliateEntry(deps: RevenueServiceDeps, id: string): Promise<AffiliateEntry> {
    const row = await affiliateEntryRepo.getById(deps.db, id);
    if (!row) {
      throw new AppError('Affiliate entry not found', {
        code: 'not_found',
        status: 404,
        details: { id },
      });
    }
    return row;
  },

  /**
   * List rows for a site. When `range` is provided, only rows whose period
   * overlaps the window are returned (sorted by `period_start` asc); when
   * omitted, the most recent N rows are returned (newest first).
   */
  async listAffiliateEntries(
    deps: RevenueServiceDeps,
    siteId: string,
    range?: DateRange,
    opts: { limit?: number } = {},
  ): Promise<AffiliateEntry[]> {
    if (range) {
      return affiliateEntryRepo.listOverlapping(deps.db, range, siteId);
    }
    return affiliateEntryRepo.listForSite(deps.db, siteId, { limit: opts.limit ?? 100 });
  },

  async listKnownPrograms(
    deps: RevenueServiceDeps,
    siteId: string,
    sinceDays = 90,
  ): Promise<string[]> {
    return affiliateEntryRepo.listKnownPrograms(deps.db, siteId, sinceDays);
  },

  // ---------- read surface (global) --------------------------------------

  async getGlobalRevenueSummary(
    deps: RevenueServiceDeps,
    range: DateRange,
  ): Promise<RevenueSummary> {
    const [adCurrent, adPrev, entriesCurrent, entriesPrev] = await Promise.all([
      sumAdSense(deps.db, range, undefined),
      sumAdSense(deps.db, previousRange(range), undefined),
      affiliateEntryRepo.listOverlapping(deps.db, range),
      affiliateEntryRepo.listOverlapping(deps.db, previousRange(range)),
    ]);
    const affCurrent = sumAffiliateInRange(entriesCurrent, range);
    const affPrev = sumAffiliateInRange(entriesPrev, previousRange(range));
    const total = round4(adCurrent + affCurrent);
    const totalPrev = round4(adPrev + affPrev);
    return {
      adRevenue: round4(adCurrent),
      affiliateRevenue: round4(affCurrent),
      total,
      totalPrev,
      delta: deltaRatio(total, totalPrev),
      topProgram: topProgramOf(entriesCurrent, range),
    };
  },

  async getGlobalRevenueSeries(
    deps: RevenueServiceDeps,
    range: DateRange,
    granularity: Granularity = 'day',
  ): Promise<RevenueSeriesResponse> {
    return readSeries(deps.db, range, granularity, undefined);
  },

  async getTopRevenueSites(
    deps: RevenueServiceDeps,
    range: DateRange,
    limit = 10,
  ): Promise<TopRevenueSiteRow[]> {
    const safeLimit = Math.min(50, Math.max(1, Math.floor(limit)));

    // AdSense totals per site (single SQL grouping).
    const adRows = await deps.db
      .select({
        siteId: adsenseDaily.siteId,
        slug: sites.slug,
        name: sites.name,
        adRevenue: sql<number>`COALESCE(SUM(${adsenseDaily.earningsUsd}), 0)::numeric`,
      })
      .from(adsenseDaily)
      .innerJoin(sites, eq(sites.id, adsenseDaily.siteId))
      .where(between(adsenseDaily.date, range.from, range.to))
      .groupBy(adsenseDaily.siteId, sites.slug, sites.name);

    // Affiliate totals per site, computed in JS via spread.
    const entries = await affiliateEntryRepo.listOverlapping(deps.db, range);
    const affBySite = new Map<string, number>();
    for (const e of entries) {
      const dollars = sumAffiliateInRange([e], range);
      affBySite.set(e.siteId, (affBySite.get(e.siteId) ?? 0) + dollars);
    }

    // Site names for affiliate-only sites need a backfill lookup. Most of
    // the time the AdSense join already returns them, so we lazily enrich.
    const merged = new Map<
      string,
      { siteId: string; slug: string; name: string; adRevenue: number; affiliateRevenue: number }
    >();
    for (const r of adRows) {
      merged.set(String(r.siteId), {
        siteId: String(r.siteId),
        slug: r.slug,
        name: r.name,
        adRevenue: num(r.adRevenue),
        affiliateRevenue: 0,
      });
    }
    const missingSiteIds: string[] = [];
    for (const [siteId, amount] of affBySite) {
      const existing = merged.get(siteId);
      if (existing) {
        existing.affiliateRevenue = amount;
      } else {
        missingSiteIds.push(siteId);
      }
    }
    if (missingSiteIds.length > 0) {
      const nameRows = await deps.db
        .select({ id: sites.id, slug: sites.slug, name: sites.name })
        .from(sites)
        .where(inArray(sites.id, missingSiteIds));
      for (const r of nameRows) {
        const id = String(r.id);
        merged.set(id, {
          siteId: id,
          slug: r.slug,
          name: r.name,
          adRevenue: 0,
          affiliateRevenue: affBySite.get(id) ?? 0,
        });
      }
    }

    const ranked = Array.from(merged.values())
      .map((r) => ({
        ...r,
        adRevenue: round4(r.adRevenue),
        affiliateRevenue: round4(r.affiliateRevenue),
        total: round4(r.adRevenue + r.affiliateRevenue),
      }))
      .filter((r) => r.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, safeLimit);

    return ranked;
  },

  // ---------- read surface (per-site) ------------------------------------

  async getSiteRevenueSummary(
    deps: RevenueServiceDeps,
    siteId: string,
    range: DateRange,
  ): Promise<RevenueSummary> {
    const [adCurrent, adPrev, entriesCurrent, entriesPrev] = await Promise.all([
      sumAdSense(deps.db, range, siteId),
      sumAdSense(deps.db, previousRange(range), siteId),
      affiliateEntryRepo.listOverlapping(deps.db, range, siteId),
      affiliateEntryRepo.listOverlapping(deps.db, previousRange(range), siteId),
    ]);
    const affCurrent = sumAffiliateInRange(entriesCurrent, range);
    const affPrev = sumAffiliateInRange(entriesPrev, previousRange(range));
    const total = round4(adCurrent + affCurrent);
    const totalPrev = round4(adPrev + affPrev);
    return {
      adRevenue: round4(adCurrent),
      affiliateRevenue: round4(affCurrent),
      total,
      totalPrev,
      delta: deltaRatio(total, totalPrev),
      topProgram: topProgramOf(entriesCurrent, range),
    };
  },

  async getSiteRevenueSeries(
    deps: RevenueServiceDeps,
    siteId: string,
    range: DateRange,
    granularity: Granularity = 'day',
  ): Promise<RevenueSeriesResponse> {
    return readSeries(deps.db, range, granularity, siteId);
  },
};

// ---------- internal helpers ---------------------------------------------

async function sumAdSense(db: Db, range: DateRange, siteId: string | undefined): Promise<number> {
  const where = siteId
    ? and(eq(adsenseDaily.siteId, siteId), between(adsenseDaily.date, range.from, range.to))
    : between(adsenseDaily.date, range.from, range.to);
  const rows = await db
    .select({
      total: sql<number>`COALESCE(SUM(${adsenseDaily.earningsUsd}), 0)::numeric`,
    })
    .from(adsenseDaily)
    .where(where);
  return num(rows[0]?.total);
}

async function readSeries(
  db: Db,
  range: DateRange,
  granularity: Granularity,
  siteId: string | undefined,
): Promise<RevenueSeriesResponse> {
  const bucketSql =
    granularity === 'week'
      ? sql<string>`to_char(date_trunc('week', ${adsenseDaily.date}::date), 'YYYY-MM-DD')`
      : sql<string>`to_char(${adsenseDaily.date}::date, 'YYYY-MM-DD')`;

  const where = siteId
    ? and(eq(adsenseDaily.siteId, siteId), between(adsenseDaily.date, range.from, range.to))
    : between(adsenseDaily.date, range.from, range.to);

  const rows = await db
    .select({
      bucket: sql<string>`${bucketSql} AS bucket`,
      ad: sql<number>`COALESCE(SUM(${adsenseDaily.earningsUsd}), 0)::numeric`,
    })
    .from(adsenseDaily)
    .where(where)
    .groupBy(sql`bucket`)
    .orderBy(sql`bucket`);

  const adByBucket = new Map<string, number>();
  for (const r of rows) {
    const key = bucketKey(String(r.bucket), granularity);
    adByBucket.set(key, num(r.ad));
  }

  const entries = await affiliateEntryRepo.listOverlapping(db, range, siteId);
  const affByBucket = new Map<string, number>();
  for (const e of entries) {
    const spread = spreadEntryToBuckets(e, range, granularity);
    for (const [k, v] of spread) {
      affByBucket.set(k, (affByBucket.get(k) ?? 0) + v);
    }
  }

  const buckets = enumerateBuckets(range.from, range.to, granularity);
  const points: RevenuePoint[] = buckets.map((date) => ({
    date,
    adRevenue: round4(adByBucket.get(date) ?? 0),
    affiliateRevenue: round4(affByBucket.get(date) ?? 0),
  }));

  // Sanity: ensure no rogue affiliate buckets fall outside the window. A
  // mis-configured period that snaps to a Monday before `range.from` could
  // theoretically appear; `clampToRange` keeps that defensive.
  for (const [k] of affByBucket) {
    if (clampToRange(k, range) === null) affByBucket.delete(k);
  }

  // Use fillDateRange purely for parity with trafficService — buckets are
  // already exhaustive, but this future-proofs against changes to enumerate.
  const dense = fillDateRange<RevenuePoint>(
    points,
    { from: range.from, to: range.to, granularity },
    (p) => p.date,
    (date) => ({ date, adRevenue: 0, affiliateRevenue: 0 }),
  );

  return { points: dense, granularity };
}

export { parseIsoDate };
