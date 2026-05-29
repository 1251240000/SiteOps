import { and, desc, eq, sql } from 'drizzle-orm';

import type { Db } from '../client.js';
import {
  analyticsEvents,
  analyticsSessions,
  sites,
  type NewAnalyticsEvent,
} from '../schema/index.js';

export type AnalyticsEventInput = Omit<NewAnalyticsEvent, 'id' | 'receivedAt'>;

export type AnalyticsOverview = {
  pv: number;
  uv: number;
  sessions: number;
  topPages: Array<{ path: string; pv: number }>;
  topReferrers: Array<{ referrer: string; count: number }>;
  webVitalsP75: Record<string, number | null>;
};

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function nullableNum(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export const analyticsRepo = {
  async findSiteByPublicKey(db: Db, siteKey: string) {
    const rows = await db
      .select()
      .from(sites)
      .where(eq(sites.publicAnalyticsKey, siteKey))
      .limit(1);
    return rows[0] ?? null;
  },

  async upsertSession(
    db: Db,
    input: {
      siteId: string;
      visitorId: string;
      sessionId: string;
      seenAt: Date;
      referrer?: string | null;
      utm?: Record<string, unknown> | null;
      device?: Record<string, unknown> | null;
    },
  ) {
    const existing = await db
      .select()
      .from(analyticsSessions)
      .where(
        and(
          eq(analyticsSessions.siteId, input.siteId),
          eq(analyticsSessions.sessionId, input.sessionId),
        ),
      )
      .limit(1);
    if (existing[0]) {
      const rows = await db
        .update(analyticsSessions)
        .set({
          lastSeenAt: input.seenAt,
          referrer: input.referrer ?? existing[0].referrer,
          utm: input.utm ?? existing[0].utm,
          device: input.device ?? existing[0].device,
        })
        .where(eq(analyticsSessions.id, existing[0].id))
        .returning();
      return rows[0] ?? existing[0];
    }
    const rows = await db
      .insert(analyticsSessions)
      .values({
        siteId: input.siteId,
        visitorId: input.visitorId,
        sessionId: input.sessionId,
        startedAt: input.seenAt,
        lastSeenAt: input.seenAt,
        referrer: input.referrer ?? null,
        utm: input.utm ?? null,
        device: input.device ?? null,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('upsertSession: insert returned no row');
    return row;
  },

  async insertEvents(db: Db, events: AnalyticsEventInput[]): Promise<number> {
    if (events.length === 0) return 0;
    const rows = await db
      .insert(analyticsEvents)
      .values(events)
      .onConflictDoNothing()
      .returning({ id: analyticsEvents.id });
    return rows.length;
  },

  async getOverview(
    db: Db,
    siteId: string,
    range: { from: Date; to: Date },
  ): Promise<AnalyticsOverview> {
    const whereRange = and(
      eq(analyticsEvents.siteId, siteId),
      sql`${analyticsEvents.occurredAt} >= ${range.from}`,
      sql`${analyticsEvents.occurredAt} <= ${range.to}`,
    );
    const [summaryRows, pageRows, refRows, vitalRows] = await Promise.all([
      db
        .select({
          pv: sql<number>`COUNT(*) FILTER (WHERE ${analyticsEvents.type} = 'pageview')::int`,
          uv: sql<number>`COUNT(DISTINCT ${analyticsEvents.visitorId})::int`,
          sessions: sql<number>`COUNT(DISTINCT ${analyticsEvents.sessionId})::int`,
        })
        .from(analyticsEvents)
        .where(whereRange),
      db
        .select({ path: analyticsEvents.path, pv: sql<number>`COUNT(*)::int` })
        .from(analyticsEvents)
        .where(and(whereRange, eq(analyticsEvents.type, 'pageview')))
        .groupBy(analyticsEvents.path)
        .orderBy(desc(sql`COUNT(*)`))
        .limit(10),
      db
        .select({ referrer: analyticsEvents.referrer, count: sql<number>`COUNT(*)::int` })
        .from(analyticsEvents)
        .where(
          and(
            whereRange,
            eq(analyticsEvents.type, 'pageview'),
            sql`${analyticsEvents.referrer} IS NOT NULL AND ${analyticsEvents.referrer} <> ''`,
          ),
        )
        .groupBy(analyticsEvents.referrer)
        .orderBy(desc(sql`COUNT(*)`))
        .limit(10),
      db
        .select({
          name: analyticsEvents.name,
          p75: sql<
            number | null
          >`percentile_disc(0.75) WITHIN GROUP (ORDER BY ((${analyticsEvents.properties}->>'value')::numeric))`,
        })
        .from(analyticsEvents)
        .where(
          and(
            whereRange,
            eq(analyticsEvents.type, 'web_vital'),
            sql`${analyticsEvents.properties} ? 'value'`,
          ),
        )
        .groupBy(analyticsEvents.name),
    ]);
    const summary = summaryRows[0];
    const webVitalsP75: Record<string, number | null> = {
      LCP: null,
      CLS: null,
      INP: null,
      FCP: null,
      TTFB: null,
    };
    for (const row of vitalRows) webVitalsP75[row.name] = nullableNum(row.p75);
    return {
      pv: num(summary?.pv),
      uv: num(summary?.uv),
      sessions: num(summary?.sessions),
      topPages: pageRows.map((r) => ({ path: r.path ?? '/', pv: num(r.pv) })),
      topReferrers: refRows.map((r) => ({ referrer: r.referrer ?? '', count: num(r.count) })),
      webVitalsP75,
    };
  },
};
