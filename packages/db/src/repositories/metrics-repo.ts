/**
 * Repository for analytics / SEO / monetization daily aggregates.
 *
 * Three tables share the same shape (one row per site per day, optionally
 * with dimensional breakdown):
 *   - `metrics_daily`         — PV / UV / sessions / bounce / revenue
 *   - `search_console_daily`  — clicks / impressions / CTR / position
 *   - `adsense_daily`         — earnings / impressions / clicks / RPM
 *
 * Each integration writer treats these as upsert by primary key; this repo
 * centralises the SQL so the integration services stay focused on transport.
 */
import { and, eq, sql, type SQL } from 'drizzle-orm';

import type { Db } from '../client.js';
import {
  adsenseDaily,
  metricsDaily,
  searchConsoleDaily,
  type AdsenseDaily,
  type MetricDaily,
  type NewAdsenseDaily,
  type NewMetricDaily,
  type NewSearchConsoleDaily,
  type SearchConsoleDaily,
} from '../schema/metrics.js';

function strNum(n: number | null | undefined): string | null {
  if (n === null || n === undefined) return null;
  if (!Number.isFinite(n)) return null;
  return n.toString();
}

export const metricsRepo = {
  // ----- metrics_daily ----------------------------------------------------
  async upsertMetricDaily(
    db: Db,
    input: {
      siteId: string;
      date: string; // YYYY-MM-DD
      pv?: number;
      uv?: number;
      sessions?: number;
      bounceRate?: number | null;
      avgSessionSec?: number | null;
      revenueUsd?: number | null;
      adRevenueUsd?: number | null;
      affiliateRevenueUsd?: number | null;
      uptimePct?: number | null;
    },
  ): Promise<MetricDaily> {
    const existing = await db
      .select()
      .from(metricsDaily)
      .where(and(eq(metricsDaily.siteId, input.siteId), eq(metricsDaily.date, input.date)))
      .limit(1);
    if (existing[0]) {
      const patch: Partial<NewMetricDaily> = {};
      if (input.pv !== undefined) patch.pv = input.pv;
      if (input.uv !== undefined) patch.uv = input.uv;
      if (input.sessions !== undefined) patch.sessions = input.sessions;
      if (input.bounceRate !== undefined) patch.bounceRate = strNum(input.bounceRate);
      if (input.avgSessionSec !== undefined) patch.avgSessionSec = input.avgSessionSec ?? null;
      if (input.revenueUsd !== undefined) patch.revenueUsd = strNum(input.revenueUsd);
      if (input.adRevenueUsd !== undefined) patch.adRevenueUsd = strNum(input.adRevenueUsd);
      if (input.affiliateRevenueUsd !== undefined)
        patch.affiliateRevenueUsd = strNum(input.affiliateRevenueUsd);
      if (input.uptimePct !== undefined) patch.uptimePct = strNum(input.uptimePct);
      const rows = await db
        .update(metricsDaily)
        .set(patch)
        .where(and(eq(metricsDaily.siteId, input.siteId), eq(metricsDaily.date, input.date)))
        .returning();
      const row = rows[0];
      if (!row) throw new Error('upsertMetricDaily: update returned no row');
      return row;
    }
    const insert: NewMetricDaily = {
      siteId: input.siteId,
      date: input.date,
      pv: input.pv ?? 0,
      uv: input.uv ?? 0,
      sessions: input.sessions ?? 0,
      bounceRate: strNum(input.bounceRate),
      avgSessionSec: input.avgSessionSec ?? null,
      revenueUsd: strNum(input.revenueUsd),
      adRevenueUsd: strNum(input.adRevenueUsd),
      affiliateRevenueUsd: strNum(input.affiliateRevenueUsd),
      uptimePct: strNum(input.uptimePct),
    };
    const rows = await db.insert(metricsDaily).values(insert).returning();
    const row = rows[0];
    if (!row) throw new Error('upsertMetricDaily: insert returned no row');
    return row;
  },

  async getMetricDaily(db: Db, siteId: string, date: string): Promise<MetricDaily | null> {
    const rows = await db
      .select()
      .from(metricsDaily)
      .where(and(eq(metricsDaily.siteId, siteId), eq(metricsDaily.date, date)))
      .limit(1);
    return rows[0] ?? null;
  },

  // ----- search_console_daily --------------------------------------------
  async upsertSearchConsoleDaily(
    db: Db,
    input: {
      siteId: string;
      date: string;
      query?: string | null;
      country?: string | null;
      device?: string | null;
      clicks: number;
      impressions: number;
      ctr?: number | null;
      position?: number | null;
    },
  ): Promise<SearchConsoleDaily> {
    const dims: SQL[] = [
      eq(searchConsoleDaily.siteId, input.siteId),
      eq(searchConsoleDaily.date, input.date),
    ];
    // NULL == NULL via COALESCE sentinels to keep the upsert idempotent.
    dims.push(
      sql`COALESCE(${searchConsoleDaily.query}, '') = COALESCE(${input.query ?? null}, '')`,
    );
    dims.push(
      sql`COALESCE(${searchConsoleDaily.country}, '') = COALESCE(${input.country ?? null}, '')`,
    );
    dims.push(
      sql`COALESCE(${searchConsoleDaily.device}, '') = COALESCE(${input.device ?? null}, '')`,
    );
    const existing = await db
      .select()
      .from(searchConsoleDaily)
      .where(and(...dims))
      .limit(1);
    if (existing[0]) {
      const patch: Partial<NewSearchConsoleDaily> = {
        clicks: input.clicks,
        impressions: input.impressions,
        ctr: strNum(input.ctr),
        position: strNum(input.position),
      };
      const rows = await db
        .update(searchConsoleDaily)
        .set(patch)
        .where(eq(searchConsoleDaily.id, existing[0].id))
        .returning();
      const row = rows[0];
      if (!row) throw new Error('upsertSearchConsoleDaily: update returned no row');
      return row;
    }
    const insert: NewSearchConsoleDaily = {
      siteId: input.siteId,
      date: input.date,
      query: input.query ?? null,
      country: input.country ?? null,
      device: input.device ?? null,
      clicks: input.clicks,
      impressions: input.impressions,
      ctr: strNum(input.ctr),
      position: strNum(input.position),
    };
    const rows = await db.insert(searchConsoleDaily).values(insert).returning();
    const row = rows[0];
    if (!row) throw new Error('upsertSearchConsoleDaily: insert returned no row');
    return row;
  },

  // ----- adsense_daily ---------------------------------------------------
  async upsertAdsenseDaily(
    db: Db,
    input: {
      siteId: string;
      date: string;
      earningsUsd: number;
      pageViews?: number;
      impressions?: number;
      clicks?: number;
      rpm?: number | null;
      ctr?: number | null;
    },
  ): Promise<AdsenseDaily> {
    const existing = await db
      .select()
      .from(adsenseDaily)
      .where(and(eq(adsenseDaily.siteId, input.siteId), eq(adsenseDaily.date, input.date)))
      .limit(1);
    if (existing[0]) {
      const patch: Partial<NewAdsenseDaily> = {
        earningsUsd: strNum(input.earningsUsd) ?? '0',
        pageViews: input.pageViews ?? 0,
        impressions: input.impressions ?? 0,
        clicks: input.clicks ?? 0,
        rpm: strNum(input.rpm),
        ctr: strNum(input.ctr),
      };
      const rows = await db
        .update(adsenseDaily)
        .set(patch)
        .where(and(eq(adsenseDaily.siteId, input.siteId), eq(adsenseDaily.date, input.date)))
        .returning();
      const row = rows[0];
      if (!row) throw new Error('upsertAdsenseDaily: update returned no row');
      return row;
    }
    const insert: NewAdsenseDaily = {
      siteId: input.siteId,
      date: input.date,
      earningsUsd: strNum(input.earningsUsd) ?? '0',
      pageViews: input.pageViews ?? 0,
      impressions: input.impressions ?? 0,
      clicks: input.clicks ?? 0,
      rpm: strNum(input.rpm),
      ctr: strNum(input.ctr),
    };
    const rows = await db.insert(adsenseDaily).values(insert).returning();
    const row = rows[0];
    if (!row) throw new Error('upsertAdsenseDaily: insert returned no row');
    return row;
  },
};
