/**
 * Uptime checks repository.
 *
 * Single-table writer for the high-volume `uptime_checks` time series.
 * Readers expose simple time-bucket aggregations (5m/1h/1d) so the API
 * route can hand a JSON-friendly series straight to the chart component.
 */
import {
  and,
  between,
  count,
  desc,
  eq,
  gte,
  isNull,
  lt,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';

import { clampLimit, encodeCursor, type Cursor } from '@siteops/shared';

import type { Db } from '../client.js';
import { uptimeChecks, type NewUptimeCheck, type UptimeCheck } from '../schema/uptime-checks.js';

export type UptimeGranularity = '5m' | '1h' | '1d';

export type UptimeRangeOptions = {
  siteId: string;
  from: Date;
  to: Date;
  granularity?: UptimeGranularity;
};

export type UptimeBucket = {
  bucket: Date;
  total: number;
  ok: number;
  avgResponseTimeMs: number | null;
};

export type UptimeSummary = {
  windowFromMs: number;
  windowToMs: number;
  total: number;
  ok: number;
  okRate: number;
  avgResponseTimeMs: number | null;
};

function granularitySql(g: UptimeGranularity): string {
  switch (g) {
    case '5m':
      return "date_trunc('minute', checked_at) - (extract(minute from checked_at)::int % 5) * interval '1 minute'";
    case '1h':
      return "date_trunc('hour', checked_at)";
    case '1d':
      return "date_trunc('day', checked_at)";
  }
}

export const uptimeRepo = {
  async insert(db: Db, row: NewUptimeCheck): Promise<UptimeCheck> {
    const rows = await db.insert(uptimeChecks).values(row).returning();
    const inserted = rows[0];
    if (!inserted) throw new Error('uptimeRepo.insert: no row returned');
    return inserted;
  },

  /** Most recent N rows; used by the "recent failures" widget. */
  async listRecent(
    db: Db,
    siteId: string,
    opts: { limit?: number; okOnly?: boolean; failuresOnly?: boolean } = {},
  ): Promise<UptimeCheck[]> {
    const limit = Math.min(200, Math.max(1, opts.limit ?? 20));
    const clauses: SQL[] = [eq(uptimeChecks.siteId, siteId)];
    if (opts.failuresOnly) clauses.push(eq(uptimeChecks.ok, false));
    if (opts.okOnly) clauses.push(eq(uptimeChecks.ok, true));
    const where = clauses.length === 1 ? clauses[0] : and(...clauses);
    return db
      .select()
      .from(uptimeChecks)
      .where(where)
      .orderBy(desc(uptimeChecks.checkedAt))
      .limit(limit);
  },

  /**
   * Keyset-paginated reader for the "recent checks" tail. The sort is
   * always `(checked_at DESC, id DESC)` so it lines up with the
   * `uptime_checks_site_checked_idx` index for fast tail-scans.
   *
   * `cursor.id` is a stringified bigint — `uptime_checks.id` is a
   * `bigserial`, so encoders / decoders use `String(row.id)`. The repo
   * casts back to `bigint` before passing to drizzle's `lt`.
   */
  async listCursor(
    db: Db,
    siteId: string,
    opts: {
      limit?: number;
      okOnly?: boolean;
      failuresOnly?: boolean;
      cursor?: Cursor;
    } = {},
  ): Promise<{ items: UptimeCheck[]; nextCursor: string | null; hasMore: boolean; limit: number }> {
    const limit = clampLimit(opts.limit, 20);
    const clauses: SQL[] = [eq(uptimeChecks.siteId, siteId)];
    if (opts.failuresOnly) clauses.push(eq(uptimeChecks.ok, false));
    if (opts.okOnly) clauses.push(eq(uptimeChecks.ok, true));

    if (opts.cursor) {
      const c = opts.cursor;
      const cursorTs = new Date(c.ts);
      // `id` is bigint at the DB level — bring the wire-string back to
      // bigint so drizzle emits the comparison as numeric, not text.
      const cursorId = BigInt(c.id);
      const keysetWhere = or(
        lt(uptimeChecks.checkedAt, cursorTs),
        and(eq(uptimeChecks.checkedAt, cursorTs), lt(uptimeChecks.id, cursorId)),
      );
      if (keysetWhere) clauses.push(keysetWhere);
    }

    const where = clauses.length === 1 ? clauses[0] : and(...clauses);
    const rows = await db
      .select()
      .from(uptimeChecks)
      .where(where)
      .orderBy(desc(uptimeChecks.checkedAt), desc(uptimeChecks.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({ id: String(last.id), ts: last.checkedAt.toISOString() })
        : null;
    return { items, nextCursor, hasMore, limit };
  },

  /** Time-bucketed series for the chart. */
  async series(db: Db, opts: UptimeRangeOptions): Promise<UptimeBucket[]> {
    const granularity = opts.granularity ?? '5m';
    const bucketSql = sql.raw(granularitySql(granularity));
    const rows = await db
      .select({
        bucket: sql<Date>`${bucketSql} AS bucket`,
        total: count(),
        ok: sql<number>`sum(case when ${uptimeChecks.ok} then 1 else 0 end)::int`,
        avgResponseTimeMs: sql<number | null>`avg(${uptimeChecks.responseTimeMs})::int`,
      })
      .from(uptimeChecks)
      .where(
        and(
          eq(uptimeChecks.siteId, opts.siteId),
          between(uptimeChecks.checkedAt, opts.from, opts.to),
        ),
      )
      .groupBy(sql`bucket`)
      .orderBy(sql`bucket`);
    return rows.map((r) => ({
      bucket: r.bucket as Date,
      total: Number(r.total ?? 0),
      ok: Number(r.ok ?? 0),
      avgResponseTimeMs: r.avgResponseTimeMs == null ? null : Number(r.avgResponseTimeMs),
    }));
  },

  /** Summary over the same window — used for the "uptime % last 24h" card. */
  async summary(db: Db, opts: Omit<UptimeRangeOptions, 'granularity'>): Promise<UptimeSummary> {
    const rows = await db
      .select({
        total: count(),
        ok: sql<number>`sum(case when ${uptimeChecks.ok} then 1 else 0 end)::int`,
        avgResponseTimeMs: sql<number | null>`avg(${uptimeChecks.responseTimeMs})::int`,
      })
      .from(uptimeChecks)
      .where(
        and(
          eq(uptimeChecks.siteId, opts.siteId),
          between(uptimeChecks.checkedAt, opts.from, opts.to),
        ),
      );
    const r = rows[0];
    const total = Number(r?.total ?? 0);
    const ok = Number(r?.ok ?? 0);
    return {
      windowFromMs: opts.from.getTime(),
      windowToMs: opts.to.getTime(),
      total,
      ok,
      okRate: total === 0 ? 1 : ok / total,
      avgResponseTimeMs: r?.avgResponseTimeMs == null ? null : Number(r.avgResponseTimeMs),
    };
  },

  /**
   * Number of consecutive failures ending at the latest check. Used by the
   * worker to decide whether to fire an alert without re-querying twice.
   */
  async consecutiveFailures(db: Db, siteId: string, lookback = 50): Promise<number> {
    const rows = await db
      .select({ ok: uptimeChecks.ok, checkedAt: uptimeChecks.checkedAt })
      .from(uptimeChecks)
      .where(eq(uptimeChecks.siteId, siteId))
      .orderBy(desc(uptimeChecks.checkedAt))
      .limit(lookback);
    let streak = 0;
    for (const row of rows) {
      if (row.ok) break;
      streak += 1;
    }
    return streak;
  },

  /** Bulk-delete rows older than `keepDays`. Used by housekeeping. */
  async pruneOlderThan(db: Db, keepDays: number): Promise<number> {
    const cutoff = new Date(Date.now() - keepDays * 24 * 60 * 60 * 1000);
    const res = await db
      .delete(uptimeChecks)
      .where(lte(uptimeChecks.checkedAt, cutoff))
      .returning({ id: uptimeChecks.id });
    return res.length;
  },
};

export { eq, gte, isNull };
