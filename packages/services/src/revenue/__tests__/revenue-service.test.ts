import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { metricsRepo, siteRepo } from '@siteops/db';
import { createTestDb, type TestDbHandle } from '@siteops/db/testing';

import { revenueService } from '../revenue-service.js';

let handle: TestDbHandle;
const deps = () => ({ db: handle.db as never });

async function seedSite(slug: string, name = slug): Promise<string> {
  const created = await siteRepo.create(handle.db as never, {
    slug,
    name,
    primaryUrl: `https://${slug}.example.com`,
    siteType: 'tool',
  });
  return created.id;
}

async function seedAdSenseDay(siteId: string, date: string, earnings: number): Promise<void> {
  await metricsRepo.upsertAdsenseDaily(handle.db as never, {
    siteId,
    date,
    earningsUsd: earnings,
  });
}

// Module-level setup so the three nested groups share one PGlite handle and
// the `afterAll` (which closes the handle) fires exactly once after every
// test has finished.
beforeEach(async () => {
  if (!handle) handle = await createTestDb();
  await handle.reset();
});

afterAll(async () => {
  if (handle) await handle.close();
});

describe('revenueService — affiliate CRUD', () => {
  it('createAffiliateEntry validates input then writes the row', async () => {
    const siteId = await seedSite('a');
    const created = await revenueService.createAffiliateEntry(deps(), siteId, {
      periodStart: '2026-04-01',
      periodEnd: '2026-04-30',
      program: 'Amazon',
      amountUsd: 60,
    });
    expect(created.siteId).toBe(siteId);
    expect(Number(created.amountUsd)).toBe(60);
  });

  it('createAffiliateEntry rejects period_end < period_start', async () => {
    const siteId = await seedSite('a');
    await expect(
      revenueService.createAffiliateEntry(deps(), siteId, {
        periodStart: '2026-04-30',
        periodEnd: '2026-04-01',
        program: 'X',
        amountUsd: 1,
      }),
    ).rejects.toMatchObject({ status: 400, code: 'validation_failed' });
  });

  it('createAffiliateEntry rejects negative amounts', async () => {
    const siteId = await seedSite('a');
    await expect(
      revenueService.createAffiliateEntry(deps(), siteId, {
        periodStart: '2026-04-01',
        periodEnd: '2026-04-30',
        program: 'X',
        amountUsd: -1,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('updateAffiliateEntry patches selected fields and 404s on unknown id', async () => {
    const siteId = await seedSite('a');
    const created = await revenueService.createAffiliateEntry(deps(), siteId, {
      periodStart: '2026-04-01',
      periodEnd: '2026-04-30',
      program: 'A',
      amountUsd: 10,
    });
    const updated = await revenueService.updateAffiliateEntry(deps(), created.id, {
      amountUsd: 12,
      notes: 'corrected',
    });
    expect(Number(updated.amountUsd)).toBe(12);
    expect(updated.notes).toBe('corrected');
    await expect(
      revenueService.updateAffiliateEntry(deps(), '00000000-0000-0000-0000-000000000000', {
        notes: 'x',
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('deleteAffiliateEntry removes the row and 404s the second time', async () => {
    const siteId = await seedSite('a');
    const created = await revenueService.createAffiliateEntry(deps(), siteId, {
      periodStart: '2026-04-01',
      periodEnd: '2026-04-30',
      program: 'A',
      amountUsd: 10,
    });
    await revenueService.deleteAffiliateEntry(deps(), created.id);
    await expect(revenueService.deleteAffiliateEntry(deps(), created.id)).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('revenueService — global aggregation', () => {
  it('sums AdSense + spread affiliate across the window with prev-period delta', async () => {
    const a = await seedSite('a');
    const b = await seedSite('b');
    // Window: 2026-05-01..2026-05-10 (10 days).
    await seedAdSenseDay(a, '2026-05-02', 10);
    await seedAdSenseDay(a, '2026-05-08', 20);
    await seedAdSenseDay(b, '2026-05-05', 5);
    // Affiliate entry: 10-day period exactly aligned with window → 30 USD spread = 30 USD.
    await revenueService.createAffiliateEntry(deps(), a, {
      periodStart: '2026-05-01',
      periodEnd: '2026-05-10',
      program: 'Amazon',
      amountUsd: 30,
    });
    // Affiliate entry: 30-day period $90 covers window 2026-05-01..2026-05-10
    // → 30 days, perDay=$3, in-window 10 days × $3 = $30.
    await revenueService.createAffiliateEntry(deps(), b, {
      periodStart: '2026-04-26',
      periodEnd: '2026-05-25',
      program: 'Impact',
      amountUsd: 90,
    });
    // Previous window: 2026-04-21..2026-04-30 (10 days)
    await seedAdSenseDay(a, '2026-04-25', 5);
    // Same Impact entry contributes 5 days into prev window: (90/30)*5 = $15.

    const summary = await revenueService.getGlobalRevenueSummary(deps(), {
      from: '2026-05-01',
      to: '2026-05-10',
    });
    expect(summary.adRevenue).toBeCloseTo(35, 4);
    expect(summary.affiliateRevenue).toBeCloseTo(60, 4);
    expect(summary.total).toBeCloseTo(95, 4);
    expect(summary.totalPrev).toBeCloseTo(5 + 15, 4);
    expect(summary.delta).toBeCloseTo((95 - 20) / 20, 4);
    // Both programs contribute $30 — Amazon wins on insertion order tie because
    // both end up at exactly 30; just assert it is one of the two.
    expect(['Amazon', 'Impact']).toContain(summary.topProgram);
  });

  it('global series spreads affiliate per day and matches AdSense day-by-day', async () => {
    const a = await seedSite('a');
    await seedAdSenseDay(a, '2026-05-01', 1);
    await seedAdSenseDay(a, '2026-05-03', 4);
    // 4-day entry, $40 → $10/day
    await revenueService.createAffiliateEntry(deps(), a, {
      periodStart: '2026-05-01',
      periodEnd: '2026-05-04',
      program: 'X',
      amountUsd: 40,
    });
    const series = await revenueService.getGlobalRevenueSeries(
      deps(),
      { from: '2026-05-01', to: '2026-05-04' },
      'day',
    );
    expect(series.granularity).toBe('day');
    expect(series.points.map((p) => p.date)).toEqual([
      '2026-05-01',
      '2026-05-02',
      '2026-05-03',
      '2026-05-04',
    ]);
    expect(series.points.map((p) => p.adRevenue)).toEqual([1, 0, 4, 0]);
    expect(series.points.map((p) => p.affiliateRevenue)).toEqual([10, 10, 10, 10]);
  });

  it('weekly granularity bucket count is ceil((to-from+1)/7)', async () => {
    const a = await seedSite('a');
    void a;
    // 22-day window → 4 weeks
    const series = await revenueService.getGlobalRevenueSeries(
      deps(),
      { from: '2026-05-04', to: '2026-05-25' },
      'week',
    );
    expect(series.granularity).toBe('week');
    expect(series.points).toHaveLength(4);
    expect(series.points.every((p) => p.adRevenue === 0 && p.affiliateRevenue === 0)).toBe(true);
  });

  it('getTopRevenueSites orders by total revenue and respects limit', async () => {
    const a = await seedSite('a', 'A');
    const b = await seedSite('b', 'B');
    const c = await seedSite('c', 'C');
    await seedAdSenseDay(a, '2026-05-05', 100);
    await seedAdSenseDay(b, '2026-05-05', 50);
    // c has only affiliate revenue
    await revenueService.createAffiliateEntry(deps(), c, {
      periodStart: '2026-05-01',
      periodEnd: '2026-05-31',
      program: 'X',
      amountUsd: 200,
    });
    const top = await revenueService.getTopRevenueSites(
      deps(),
      { from: '2026-05-01', to: '2026-05-31' },
      2,
    );
    expect(top).toHaveLength(2);
    // c: full $200 in window, a: $100, b: $50
    expect(top[0]?.slug).toBe('c');
    expect(top[1]?.slug).toBe('a');
    expect(top[0]?.adRevenue).toBe(0);
    expect(top[0]?.affiliateRevenue).toBeCloseTo(200, 4);
  });
});

describe('revenueService — per-site symmetry', () => {
  it('site summary equals the global summary when only one site has data', async () => {
    const a = await seedSite('a');
    await seedAdSenseDay(a, '2026-05-02', 7);
    await revenueService.createAffiliateEntry(deps(), a, {
      periodStart: '2026-05-01',
      periodEnd: '2026-05-10',
      program: 'A',
      amountUsd: 100,
    });
    const range = { from: '2026-05-01', to: '2026-05-10' };
    const [siteSum, globalSum] = await Promise.all([
      revenueService.getSiteRevenueSummary(deps(), a, range),
      revenueService.getGlobalRevenueSummary(deps(), range),
    ]);
    expect(siteSum.adRevenue).toBeCloseTo(globalSum.adRevenue, 4);
    expect(siteSum.affiliateRevenue).toBeCloseTo(globalSum.affiliateRevenue, 4);
    expect(siteSum.total).toBeCloseTo(globalSum.total, 4);
  });

  it('site summary excludes other sites', async () => {
    const a = await seedSite('a');
    const b = await seedSite('b');
    await seedAdSenseDay(a, '2026-05-02', 50);
    await seedAdSenseDay(b, '2026-05-02', 999);
    const sum = await revenueService.getSiteRevenueSummary(deps(), a, {
      from: '2026-05-01',
      to: '2026-05-10',
    });
    expect(sum.adRevenue).toBeCloseTo(50, 4);
    expect(sum.total).toBeCloseTo(50, 4);
  });

  it('site series only includes the requested site', async () => {
    const a = await seedSite('a');
    const b = await seedSite('b');
    await seedAdSenseDay(a, '2026-05-01', 3);
    await seedAdSenseDay(b, '2026-05-01', 999);
    const res = await revenueService.getSiteRevenueSeries(
      deps(),
      a,
      { from: '2026-05-01', to: '2026-05-03' },
      'day',
    );
    expect(res.points[0]?.adRevenue).toBe(3);
    expect(res.points[1]?.adRevenue).toBe(0);
  });

  it('listAffiliateEntries with range returns only overlapping rows', async () => {
    const a = await seedSite('a');
    await revenueService.createAffiliateEntry(deps(), a, {
      periodStart: '2026-04-01',
      periodEnd: '2026-04-30',
      program: 'Outside',
      amountUsd: 1,
    });
    const inside = await revenueService.createAffiliateEntry(deps(), a, {
      periodStart: '2026-05-05',
      periodEnd: '2026-05-15',
      program: 'Inside',
      amountUsd: 1,
    });
    const out = await revenueService.listAffiliateEntries(deps(), a, {
      from: '2026-05-01',
      to: '2026-05-31',
    });
    expect(out.map((r) => r.id)).toEqual([inside.id]);
  });
});
