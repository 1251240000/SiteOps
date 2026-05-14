import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { metricsRepo, siteRepo } from '@siteops/db';
import { createTestDb, type TestDbHandle } from '@siteops/db/testing';

import { trafficService } from '../traffic-service.js';

let handle: TestDbHandle;

async function seedSite(slug: string, name = slug): Promise<string> {
  const created = await siteRepo.create(handle.db as never, {
    slug,
    name,
    primaryUrl: `https://${slug}.example.com`,
    siteType: 'tool',
  });
  return created.id;
}

async function seedDay(
  siteId: string,
  date: string,
  values: {
    pv?: number;
    uv?: number;
    sessions?: number;
    avgSessionSec?: number;
    bounceRate?: number;
  },
): Promise<void> {
  await metricsRepo.upsertMetricDaily(handle.db as never, {
    siteId,
    date,
    pv: values.pv ?? 0,
    uv: values.uv ?? 0,
    sessions: values.sessions ?? 0,
    avgSessionSec: values.avgSessionSec ?? null,
    bounceRate: values.bounceRate ?? null,
  });
}

async function seedSearch(
  siteId: string,
  date: string,
  values: {
    query?: string | null;
    clicks: number;
    impressions: number;
    position?: number;
  },
): Promise<void> {
  await metricsRepo.upsertSearchConsoleDaily(handle.db as never, {
    siteId,
    date,
    query: values.query ?? null,
    country: null,
    device: null,
    clicks: values.clicks,
    impressions: values.impressions,
    ctr: values.impressions === 0 ? 0 : values.clicks / values.impressions,
    position: values.position ?? null,
  });
}

describe('trafficService', () => {
  beforeEach(async () => {
    if (!handle) handle = await createTestDb();
    await handle.reset();
  });

  afterAll(async () => {
    if (handle) await handle.close();
  });

  describe('getGlobalSummary', () => {
    it('sums pv/uv/sessions across all sites and computes prev-window delta', async () => {
      const a = await seedSite('a');
      const b = await seedSite('b');
      // Current window: 2026-05-08..2026-05-14
      await seedDay(a, '2026-05-08', { pv: 100, uv: 50, sessions: 60 });
      await seedDay(a, '2026-05-09', { pv: 200, uv: 80, sessions: 100 });
      await seedDay(b, '2026-05-09', { pv: 50, uv: 20, sessions: 30 });
      // Previous window: 2026-05-01..2026-05-07
      await seedDay(a, '2026-05-02', { pv: 100, uv: 40, sessions: 50 });
      await seedDay(b, '2026-05-03', { pv: 100, uv: 40, sessions: 50 });
      // Outside both windows
      await seedDay(a, '2026-04-20', { pv: 9999 });

      const summary = await trafficService.getGlobalSummary(handle.db as never, {
        from: '2026-05-08',
        to: '2026-05-14',
      });

      expect(summary.pv).toBe(350);
      expect(summary.uv).toBe(150);
      expect(summary.sessions).toBe(190);
      expect(summary.pvPrev).toBe(200);
      expect(summary.uvPrev).toBe(80);
      expect(summary.sessionsPrev).toBe(100);
      expect(summary.delta.pv).toBeCloseTo((350 - 200) / 200, 5);
      expect(summary.delta.uv).toBeCloseTo((150 - 80) / 80, 5);
    });

    it('returns zero deltas when previous window had no data', async () => {
      const a = await seedSite('only-current');
      await seedDay(a, '2026-05-09', { pv: 10, uv: 5, sessions: 6 });
      const summary = await trafficService.getGlobalSummary(handle.db as never, {
        from: '2026-05-08',
        to: '2026-05-14',
      });
      expect(summary.pv).toBe(10);
      expect(summary.delta.pv).toBe(0);
      expect(summary.delta.uv).toBe(0);
      expect(summary.delta.sessions).toBe(0);
    });

    it('produces session-weighted average session length and bounce rate', async () => {
      const a = await seedSite('w');
      // 100 sessions × 30s + 200 sessions × 60s = 15000s ÷ 300 sessions = 50s
      await seedDay(a, '2026-05-09', {
        pv: 1,
        uv: 1,
        sessions: 100,
        avgSessionSec: 30,
        bounceRate: 0.4,
      });
      await seedDay(a, '2026-05-10', {
        pv: 1,
        uv: 1,
        sessions: 200,
        avgSessionSec: 60,
        bounceRate: 0.7,
      });
      const summary = await trafficService.getGlobalSummary(handle.db as never, {
        from: '2026-05-08',
        to: '2026-05-14',
      });
      expect(summary.avgSessionSec).toBe(50);
      // (100×0.4 + 200×0.7) / 300 ≈ 0.6
      expect(summary.bounceRate).toBeCloseTo(0.6, 4);
    });
  });

  describe('getGlobalSeries', () => {
    it('returns one point per day inclusive of both endpoints, gap-free', async () => {
      const a = await seedSite('a');
      await seedDay(a, '2026-05-10', { pv: 10 });
      await seedDay(a, '2026-05-12', { pv: 30 });
      const res = await trafficService.getGlobalSeries(
        handle.db as never,
        { from: '2026-05-10', to: '2026-05-13' },
        'day',
      );
      expect(res.granularity).toBe('day');
      expect(res.points.map((p) => p.date)).toEqual([
        '2026-05-10',
        '2026-05-11',
        '2026-05-12',
        '2026-05-13',
      ]);
      expect(res.points.map((p) => p.pv)).toEqual([10, 0, 30, 0]);
    });

    it('weekly granularity bucket-count = ceil((to-from+1)/7)', async () => {
      const a = await seedSite('a');
      // 22-day window → ceil(22/7) = 4 weeks
      const res = await trafficService.getGlobalSeries(
        handle.db as never,
        { from: '2026-05-04', to: '2026-05-25' },
        'week',
      );
      expect(res.granularity).toBe('week');
      expect(res.points).toHaveLength(4);
      // Buckets are Mondays
      expect(res.points.map((p) => p.date)).toEqual([
        '2026-05-04',
        '2026-05-11',
        '2026-05-18',
        '2026-05-25',
      ]);
      // No data → all zeros
      expect(res.points.every((p) => p.pv === 0 && p.uv === 0 && p.sessions === 0)).toBe(true);
      void a;
    });
  });

  describe('getTopSites', () => {
    it('orders by chosen metric desc and respects limit', async () => {
      const a = await seedSite('a', 'A');
      const b = await seedSite('b', 'B');
      const c = await seedSite('c', 'C');
      await seedDay(a, '2026-05-10', { pv: 100, uv: 30 });
      await seedDay(b, '2026-05-10', { pv: 200, uv: 10 });
      await seedDay(c, '2026-05-10', { pv: 50, uv: 80 });

      const byPv = await trafficService.getTopSites(
        handle.db as never,
        { from: '2026-05-08', to: '2026-05-14' },
        'pv',
        2,
      );
      expect(byPv.map((r) => r.slug)).toEqual(['b', 'a']);

      const byUv = await trafficService.getTopSites(
        handle.db as never,
        { from: '2026-05-08', to: '2026-05-14' },
        'uv',
        10,
      );
      expect(byUv.map((r) => r.slug)).toEqual(['c', 'a', 'b']);
    });

    it('returns an empty list when no rows in window', async () => {
      const top = await trafficService.getTopSites(
        handle.db as never,
        { from: '2026-05-08', to: '2026-05-14' },
        'pv',
      );
      expect(top).toEqual([]);
    });
  });

  describe('getSiteSeries', () => {
    it('only sums the given site and pads missing days', async () => {
      const a = await seedSite('a');
      const b = await seedSite('b');
      await seedDay(a, '2026-05-10', { pv: 11 });
      await seedDay(b, '2026-05-10', { pv: 99 });
      await seedDay(a, '2026-05-12', { pv: 13 });
      const res = await trafficService.getSiteSeries(
        handle.db as never,
        a,
        { from: '2026-05-10', to: '2026-05-12' },
        'day',
      );
      expect(res.points.map((p) => p.pv)).toEqual([11, 0, 13]);
    });
  });

  describe('getSiteSearchSummary', () => {
    it('reads only the aggregate (NULL dimensions) row and weighs avg position by impressions', async () => {
      const a = await seedSite('a');
      // Aggregate rows
      await seedSearch(a, '2026-05-09', { clicks: 10, impressions: 100, position: 5 });
      await seedSearch(a, '2026-05-10', { clicks: 20, impressions: 300, position: 9 });
      // Dimensional row that must NOT be summed into the totals
      await seedSearch(a, '2026-05-09', {
        query: 'foo',
        clicks: 999,
        impressions: 9999,
        position: 1,
      });
      const sum = await trafficService.getSiteSearchSummary(handle.db as never, a, {
        from: '2026-05-08',
        to: '2026-05-14',
      });
      expect(sum.clicks).toBe(30);
      expect(sum.impressions).toBe(400);
      expect(sum.ctr).toBeCloseTo(30 / 400, 5);
      // (5×100 + 9×300) / 400 = 8
      expect(sum.avgPosition).toBeCloseTo(8, 4);
    });

    it('returns zeros when no rows in window', async () => {
      const a = await seedSite('empty');
      const sum = await trafficService.getSiteSearchSummary(handle.db as never, a, {
        from: '2026-05-08',
        to: '2026-05-14',
      });
      expect(sum.clicks).toBe(0);
      expect(sum.impressions).toBe(0);
      expect(sum.ctr).toBe(0);
      expect(sum.avgPosition).toBeNull();
    });
  });

  describe('getSiteTopQueries', () => {
    it('groups by query, ignores aggregate rows, orders by clicks desc', async () => {
      const a = await seedSite('a');
      // aggregate (must be ignored)
      await seedSearch(a, '2026-05-09', { clicks: 999, impressions: 9999, position: 1 });
      await seedSearch(a, '2026-05-09', { query: 'foo', clicks: 5, impressions: 50, position: 3 });
      await seedSearch(a, '2026-05-10', { query: 'foo', clicks: 5, impressions: 50, position: 5 });
      await seedSearch(a, '2026-05-09', {
        query: 'bar',
        clicks: 20,
        impressions: 200,
        position: 2,
      });
      const top = await trafficService.getSiteTopQueries(
        handle.db as never,
        a,
        { from: '2026-05-08', to: '2026-05-14' },
        5,
      );
      expect(top.map((r) => r.query)).toEqual(['bar', 'foo']);
      expect(top[0]?.clicks).toBe(20);
      expect(top[1]?.clicks).toBe(10);
      expect(top[1]?.impressions).toBe(100);
      expect(top[1]?.ctr).toBeCloseTo(0.1, 5);
      expect(top[1]?.position).toBeCloseTo(4, 4);
    });
  });
});
