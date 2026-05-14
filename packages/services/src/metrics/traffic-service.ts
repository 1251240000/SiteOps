/**
 * Traffic service.
 *
 * Reads `metrics_daily` (GA4 / Plausible) and `search_console_daily` (GSC)
 * and produces the aggregated views the dashboard needs:
 *   - global / per-site summaries with same-window comparison
 *   - dense day/week series (no gaps — `fillDateRange` pads silent buckets)
 *   - Top-N sites by a chosen metric
 *   - GSC search console summary + Top-N queries per site
 *
 * Every method receives the Drizzle handle explicitly; route handlers
 * inject `getDb()` so this module stays pure and trivially testable.
 *
 * The dashboard (and downstream agent/API consumers) never call Drizzle
 * directly — keeping the SQL inside the service module means the API
 * contracts are stable even if the underlying tables grow new columns.
 */
import { and, asc, between, desc, eq, isNull, sql } from 'drizzle-orm';

import { metricsDaily, searchConsoleDaily, sites, type Db } from '@siteops/db';
import {
  addDays,
  enumerateBuckets,
  fillDateRange,
  startOfIsoWeek,
  type Granularity,
} from '@siteops/shared';

export type DateRange = {
  /** Inclusive `YYYY-MM-DD` (UTC). */
  from: string;
  /** Inclusive `YYYY-MM-DD` (UTC). */
  to: string;
};

export type TopMetric = 'pv' | 'uv' | 'sessions';

export type GlobalSummary = {
  pv: number;
  uv: number;
  sessions: number;
  avgSessionSec: number | null;
  bounceRate: number | null;
  pvPrev: number;
  uvPrev: number;
  sessionsPrev: number;
  /** Decimal change ratio (current − prev) / prev, clamped, or 0 when prev=0. */
  delta: { pv: number; uv: number; sessions: number };
};

export type SeriesPoint = {
  date: string;
  pv: number;
  uv: number;
  sessions: number;
};

export type SeriesResponse = {
  points: SeriesPoint[];
  granularity: Granularity;
};

export type TopSiteRow = {
  siteId: string;
  slug: string;
  name: string;
  pv: number;
  uv: number;
  sessions: number;
};

export type SearchSummary = {
  impressions: number;
  clicks: number;
  ctr: number;
  avgPosition: number | null;
};

export type TopQueryRow = {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number | null;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function nullableNum(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function deltaRatio(current: number, prev: number): number {
  if (prev === 0) return 0;
  return (current - prev) / prev;
}

/**
 * Day count for `[from, to]` inclusive, used to compute the comparison
 * window of the same length immediately preceding it.
 */
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

// note: ISO week 1=Monday — matches Postgres `date_trunc('week', ...)` so
// the SQL bucket and the JS pre-fill agree on Monday-anchored weeks.
function bucketDate(date: string, granularity: Granularity): string {
  return granularity === 'week' ? startOfIsoWeek(date) : date;
}

export const trafficService = {
  // ---------- global ------------------------------------------------------

  async getGlobalSummary(db: Db, range: DateRange): Promise<GlobalSummary> {
    const sumRow = async (window: DateRange) => {
      const rows = await db
        .select({
          pv: sql<number>`COALESCE(SUM(${metricsDaily.pv}), 0)::int`,
          uv: sql<number>`COALESCE(SUM(${metricsDaily.uv}), 0)::int`,
          sessions: sql<number>`COALESCE(SUM(${metricsDaily.sessions}), 0)::int`,
          // Time-weighted average session length (seconds) — guard against
          // zero sessions so we don't divide by zero.
          avgSessionSec: sql<number | null>`CASE
              WHEN COALESCE(SUM(${metricsDaily.sessions}), 0) = 0 THEN NULL
              ELSE (
                SUM(${metricsDaily.avgSessionSec} * ${metricsDaily.sessions})::numeric
                / NULLIF(SUM(${metricsDaily.sessions}), 0)
              )::numeric
            END`,
          bounceRate: sql<number | null>`CASE
              WHEN COALESCE(SUM(${metricsDaily.sessions}), 0) = 0 THEN NULL
              ELSE (
                SUM(${metricsDaily.bounceRate} * ${metricsDaily.sessions})::numeric
                / NULLIF(SUM(${metricsDaily.sessions}), 0)
              )::numeric
            END`,
        })
        .from(metricsDaily)
        .where(between(metricsDaily.date, window.from, window.to));
      const r = rows[0];
      return {
        pv: num(r?.pv),
        uv: num(r?.uv),
        sessions: num(r?.sessions),
        avgSessionSec: nullableNum(r?.avgSessionSec),
        bounceRate: nullableNum(r?.bounceRate),
      };
    };

    const [current, prev] = await Promise.all([sumRow(range), sumRow(previousRange(range))]);

    return {
      pv: current.pv,
      uv: current.uv,
      sessions: current.sessions,
      avgSessionSec: current.avgSessionSec === null ? null : Math.round(current.avgSessionSec),
      bounceRate: current.bounceRate,
      pvPrev: prev.pv,
      uvPrev: prev.uv,
      sessionsPrev: prev.sessions,
      delta: {
        pv: deltaRatio(current.pv, prev.pv),
        uv: deltaRatio(current.uv, prev.uv),
        sessions: deltaRatio(current.sessions, prev.sessions),
      },
    };
  },

  async getGlobalSeries(
    db: Db,
    range: DateRange,
    granularity: Granularity = 'day',
  ): Promise<SeriesResponse> {
    const bucketSql =
      granularity === 'week'
        ? sql<string>`to_char(date_trunc('week', ${metricsDaily.date}::date), 'YYYY-MM-DD')`
        : sql<string>`to_char(${metricsDaily.date}::date, 'YYYY-MM-DD')`;

    const rows = await db
      .select({
        bucket: sql<string>`${bucketSql} AS bucket`,
        pv: sql<number>`COALESCE(SUM(${metricsDaily.pv}), 0)::int`,
        uv: sql<number>`COALESCE(SUM(${metricsDaily.uv}), 0)::int`,
        sessions: sql<number>`COALESCE(SUM(${metricsDaily.sessions}), 0)::int`,
      })
      .from(metricsDaily)
      .where(between(metricsDaily.date, range.from, range.to))
      .groupBy(sql`bucket`)
      .orderBy(sql`bucket`);

    const dense = fillDateRange<SeriesPoint>(
      rows.map((r) => ({
        date: bucketDate(String(r.bucket), granularity),
        pv: num(r.pv),
        uv: num(r.uv),
        sessions: num(r.sessions),
      })),
      { from: range.from, to: range.to, granularity },
      (r) => r.date,
      (date) => ({ date, pv: 0, uv: 0, sessions: 0 }),
    );

    return { points: dense, granularity };
  },

  async getTopSites(
    db: Db,
    range: DateRange,
    metric: TopMetric = 'pv',
    limit = 10,
  ): Promise<TopSiteRow[]> {
    const sortColumn = (() => {
      switch (metric) {
        case 'uv':
          return metricsDaily.uv;
        case 'sessions':
          return metricsDaily.sessions;
        case 'pv':
        default:
          return metricsDaily.pv;
      }
    })();

    const safeLimit = Math.min(50, Math.max(1, Math.floor(limit)));

    const rows = await db
      .select({
        siteId: metricsDaily.siteId,
        slug: sites.slug,
        name: sites.name,
        pv: sql<number>`COALESCE(SUM(${metricsDaily.pv}), 0)::int`,
        uv: sql<number>`COALESCE(SUM(${metricsDaily.uv}), 0)::int`,
        sessions: sql<number>`COALESCE(SUM(${metricsDaily.sessions}), 0)::int`,
      })
      .from(metricsDaily)
      .innerJoin(sites, eq(sites.id, metricsDaily.siteId))
      .where(between(metricsDaily.date, range.from, range.to))
      .groupBy(metricsDaily.siteId, sites.slug, sites.name)
      .orderBy(desc(sql`SUM(${sortColumn})`))
      .limit(safeLimit);

    return rows.map((r) => ({
      siteId: String(r.siteId),
      slug: r.slug,
      name: r.name,
      pv: num(r.pv),
      uv: num(r.uv),
      sessions: num(r.sessions),
    }));
  },

  // ---------- per-site ----------------------------------------------------

  async getSiteSummary(db: Db, siteId: string, range: DateRange): Promise<GlobalSummary> {
    const sumRow = async (window: DateRange) => {
      const rows = await db
        .select({
          pv: sql<number>`COALESCE(SUM(${metricsDaily.pv}), 0)::int`,
          uv: sql<number>`COALESCE(SUM(${metricsDaily.uv}), 0)::int`,
          sessions: sql<number>`COALESCE(SUM(${metricsDaily.sessions}), 0)::int`,
          avgSessionSec: sql<number | null>`CASE
              WHEN COALESCE(SUM(${metricsDaily.sessions}), 0) = 0 THEN NULL
              ELSE (
                SUM(${metricsDaily.avgSessionSec} * ${metricsDaily.sessions})::numeric
                / NULLIF(SUM(${metricsDaily.sessions}), 0)
              )::numeric
            END`,
          bounceRate: sql<number | null>`CASE
              WHEN COALESCE(SUM(${metricsDaily.sessions}), 0) = 0 THEN NULL
              ELSE (
                SUM(${metricsDaily.bounceRate} * ${metricsDaily.sessions})::numeric
                / NULLIF(SUM(${metricsDaily.sessions}), 0)
              )::numeric
            END`,
        })
        .from(metricsDaily)
        .where(
          and(eq(metricsDaily.siteId, siteId), between(metricsDaily.date, window.from, window.to)),
        );
      const r = rows[0];
      return {
        pv: num(r?.pv),
        uv: num(r?.uv),
        sessions: num(r?.sessions),
        avgSessionSec: nullableNum(r?.avgSessionSec),
        bounceRate: nullableNum(r?.bounceRate),
      };
    };

    const [current, prev] = await Promise.all([sumRow(range), sumRow(previousRange(range))]);

    return {
      pv: current.pv,
      uv: current.uv,
      sessions: current.sessions,
      avgSessionSec: current.avgSessionSec === null ? null : Math.round(current.avgSessionSec),
      bounceRate: current.bounceRate,
      pvPrev: prev.pv,
      uvPrev: prev.uv,
      sessionsPrev: prev.sessions,
      delta: {
        pv: deltaRatio(current.pv, prev.pv),
        uv: deltaRatio(current.uv, prev.uv),
        sessions: deltaRatio(current.sessions, prev.sessions),
      },
    };
  },

  async getSiteSeries(
    db: Db,
    siteId: string,
    range: DateRange,
    granularity: Granularity = 'day',
  ): Promise<SeriesResponse> {
    const bucketSql =
      granularity === 'week'
        ? sql<string>`to_char(date_trunc('week', ${metricsDaily.date}::date), 'YYYY-MM-DD')`
        : sql<string>`to_char(${metricsDaily.date}::date, 'YYYY-MM-DD')`;

    const rows = await db
      .select({
        bucket: sql<string>`${bucketSql} AS bucket`,
        pv: sql<number>`COALESCE(SUM(${metricsDaily.pv}), 0)::int`,
        uv: sql<number>`COALESCE(SUM(${metricsDaily.uv}), 0)::int`,
        sessions: sql<number>`COALESCE(SUM(${metricsDaily.sessions}), 0)::int`,
      })
      .from(metricsDaily)
      .where(and(eq(metricsDaily.siteId, siteId), between(metricsDaily.date, range.from, range.to)))
      .groupBy(sql`bucket`)
      .orderBy(sql`bucket`);

    const dense = fillDateRange<SeriesPoint>(
      rows.map((r) => ({
        date: bucketDate(String(r.bucket), granularity),
        pv: num(r.pv),
        uv: num(r.uv),
        sessions: num(r.sessions),
      })),
      { from: range.from, to: range.to, granularity },
      (r) => r.date,
      (date) => ({ date, pv: 0, uv: 0, sessions: 0 }),
    );

    return { points: dense, granularity };
  },

  // ---------- search console ---------------------------------------------

  /**
   * GSC totals for a site over the window.
   *
   * The `search_console_daily` table holds both per-dimension rows (query /
   * country / device) and an aggregate "total" row where every dimension
   * is NULL. The aggregate row is what GA writers ingest by default; we
   * read only those rows to avoid double-counting the dimensional break-
   * down. See `metrics-repo.ts` for how rows are upserted.
   */
  async getSiteSearchSummary(db: Db, siteId: string, range: DateRange): Promise<SearchSummary> {
    const rows = await db
      .select({
        impressions: sql<number>`COALESCE(SUM(${searchConsoleDaily.impressions}), 0)::int`,
        clicks: sql<number>`COALESCE(SUM(${searchConsoleDaily.clicks}), 0)::int`,
        // Impression-weighted average position; NULL when no impressions.
        avgPosition: sql<number | null>`CASE
            WHEN COALESCE(SUM(${searchConsoleDaily.impressions}), 0) = 0 THEN NULL
            ELSE (
              SUM(${searchConsoleDaily.position} * ${searchConsoleDaily.impressions})::numeric
              / NULLIF(SUM(${searchConsoleDaily.impressions}), 0)
            )::numeric
          END`,
      })
      .from(searchConsoleDaily)
      .where(
        and(
          eq(searchConsoleDaily.siteId, siteId),
          between(searchConsoleDaily.date, range.from, range.to),
          isNull(searchConsoleDaily.query),
          isNull(searchConsoleDaily.country),
          isNull(searchConsoleDaily.device),
        ),
      );
    const r = rows[0];
    const impressions = num(r?.impressions);
    const clicks = num(r?.clicks);
    const ctr = impressions === 0 ? 0 : clicks / impressions;
    return {
      impressions,
      clicks,
      ctr,
      avgPosition: nullableNum(r?.avgPosition),
    };
  },

  async getSiteTopQueries(
    db: Db,
    siteId: string,
    range: DateRange,
    limit = 10,
  ): Promise<TopQueryRow[]> {
    const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
    const rows = await db
      .select({
        query: searchConsoleDaily.query,
        clicks: sql<number>`COALESCE(SUM(${searchConsoleDaily.clicks}), 0)::int`,
        impressions: sql<number>`COALESCE(SUM(${searchConsoleDaily.impressions}), 0)::int`,
        avgPosition: sql<number | null>`CASE
            WHEN COALESCE(SUM(${searchConsoleDaily.impressions}), 0) = 0 THEN NULL
            ELSE (
              SUM(${searchConsoleDaily.position} * ${searchConsoleDaily.impressions})::numeric
              / NULLIF(SUM(${searchConsoleDaily.impressions}), 0)
            )::numeric
          END`,
      })
      .from(searchConsoleDaily)
      .where(
        and(
          eq(searchConsoleDaily.siteId, siteId),
          between(searchConsoleDaily.date, range.from, range.to),
          // Only dimensional rows have a non-null query.
          sql`${searchConsoleDaily.query} IS NOT NULL`,
        ),
      )
      .groupBy(searchConsoleDaily.query)
      .orderBy(
        desc(sql`SUM(${searchConsoleDaily.clicks})`),
        desc(sql`SUM(${searchConsoleDaily.impressions})`),
      )
      .limit(safeLimit);

    return rows.map((r) => {
      const impressions = num(r.impressions);
      const clicks = num(r.clicks);
      return {
        query: r.query ?? '',
        clicks,
        impressions,
        ctr: impressions === 0 ? 0 : clicks / impressions,
        position: nullableNum(r.avgPosition),
      };
    });
  },
};

export { addDays, enumerateBuckets, asc };
