import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { metricsRepo, siteRepo, siteCostRepo } from '@siteops/db';
import { createTestDb, type TestDbHandle } from '@siteops/db/testing';

import { revenueService } from '../../revenue/revenue-service.js';
import { roiService } from '../roi-service.js';

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

async function seedMetricsDay(siteId: string, date: string, pv: number, uv = pv): Promise<void> {
  await metricsRepo.upsertMetricDaily(handle.db as never, {
    siteId,
    date,
    pv,
    uv,
    sessions: pv,
  });
}

beforeEach(async () => {
  if (!handle) handle = await createTestDb();
  await handle.reset();
});

afterAll(async () => {
  if (handle) await handle.close();
});

describe('roiService — site cost CRUD', () => {
  it('creates a site cost row through the service (zod-validated)', async () => {
    const siteId = await seedSite('a');
    const created = await roiService.createSiteCost(deps(), siteId, {
      month: '2026-04-01',
      hostingUsd: 30,
      domainUsd: 1.5,
      contentUsd: 0,
      adsSpendUsd: 0,
      otherUsd: 0,
    });
    expect(created.siteId).toBe(siteId);
    expect(Number(created.hostingUsd)).toBe(30);
  });

  it('rejects months that are not the 1st of the month', async () => {
    const siteId = await seedSite('a');
    await expect(
      roiService.createSiteCost(deps(), siteId, {
        month: '2026-04-15',
        hostingUsd: 5,
      }),
    ).rejects.toMatchObject({ status: 400, code: 'validation_failed' });
  });

  it('rejects an entry with all-zero costs (must spend on something)', async () => {
    const siteId = await seedSite('a');
    await expect(
      roiService.createSiteCost(deps(), siteId, {
        month: '2026-04-01',
        hostingUsd: 0,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('returns 409 on duplicate (siteId, month)', async () => {
    const siteId = await seedSite('a');
    await roiService.createSiteCost(deps(), siteId, {
      month: '2026-04-01',
      hostingUsd: 1,
    });
    await expect(
      roiService.createSiteCost(deps(), siteId, {
        month: '2026-04-01',
        hostingUsd: 2,
      }),
    ).rejects.toMatchObject({ status: 409, code: 'conflict' });
  });

  it('updateSiteCost patches selected fields and 404s on unknown id', async () => {
    const siteId = await seedSite('a');
    const created = await roiService.createSiteCost(deps(), siteId, {
      month: '2026-04-01',
      hostingUsd: 10,
    });
    const updated = await roiService.updateSiteCost(deps(), created.id, {
      hostingUsd: 12,
    });
    expect(Number(updated.hostingUsd)).toBe(12);
    await expect(
      roiService.updateSiteCost(deps(), '00000000-0000-0000-0000-000000000000', {
        hostingUsd: 1,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('deleteSiteCost removes the row, then 404s on retry', async () => {
    const siteId = await seedSite('a');
    const created = await roiService.createSiteCost(deps(), siteId, {
      month: '2026-04-01',
      hostingUsd: 5,
    });
    await roiService.deleteSiteCost(deps(), created.id);
    await expect(roiService.deleteSiteCost(deps(), created.id)).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('roiService — getSiteRoi', () => {
  it('amortises a one-month cost across days inside the request window', async () => {
    const siteId = await seedSite('a');
    // April has 30 days. Hosting=$30 → $1/day.
    await roiService.createSiteCost(deps(), siteId, {
      month: '2026-04-01',
      hostingUsd: 30,
    });
    // Window: April 10 → April 19 (10 days) → cost = $10
    await seedAdSenseDay(siteId, '2026-04-15', 50);
    await seedMetricsDay(siteId, '2026-04-15', 5000, 4000);

    const detail = await roiService.getSiteRoi(deps(), siteId, {
      from: '2026-04-10',
      to: '2026-04-19',
    });
    expect(detail.cost).toBeCloseTo(10, 4);
    expect(detail.revenue).toBeCloseTo(50, 4);
    expect(detail.profit).toBeCloseTo(40, 4);
    expect(detail.roi).toBeCloseTo(40 / 10, 4);
    // RPM = 50 / 5000 * 1000 = 10
    expect(detail.rpm).toBeCloseTo(10, 4);
    // arpu = 50 / 4000 = 0.0125
    expect(detail.arpu).toBeCloseTo(0.0125, 4);
    // breakdown sums match
    expect(detail.breakdown.hostingCost).toBeCloseTo(10, 4);
    expect(detail.breakdown.domainCost).toBe(0);
  });

  it('cross-month windows allocate cost per month independently', async () => {
    const siteId = await seedSite('a');
    // March has 31 days → hosting $31 → $1/day → 17 March days = $17
    // April has 30 days → hosting $60 → $2/day → 14 April days = $28
    // Total expected: $45
    await roiService.createSiteCost(deps(), siteId, {
      month: '2026-03-01',
      hostingUsd: 31,
    });
    await roiService.createSiteCost(deps(), siteId, {
      month: '2026-04-01',
      hostingUsd: 60,
    });

    const detail = await roiService.getSiteRoi(deps(), siteId, {
      from: '2026-03-15', // 17 days in March
      to: '2026-04-14', // 14 days in April
    });
    expect(detail.cost).toBeCloseTo(45, 4);
  });

  it('returns roi=null when there are no cost rows in the window', async () => {
    const siteId = await seedSite('a');
    await seedAdSenseDay(siteId, '2026-04-15', 100);
    const detail = await roiService.getSiteRoi(deps(), siteId, {
      from: '2026-04-10',
      to: '2026-04-19',
    });
    expect(detail.cost).toBe(0);
    expect(detail.roi).toBeNull();
    expect(detail.profit).toBeCloseTo(100, 4);
  });

  it('returns rpm=null when pv is zero', async () => {
    const siteId = await seedSite('a');
    await roiService.createSiteCost(deps(), siteId, {
      month: '2026-04-01',
      hostingUsd: 30,
    });
    const detail = await roiService.getSiteRoi(deps(), siteId, {
      from: '2026-04-10',
      to: '2026-04-19',
    });
    expect(detail.rpm).toBeNull();
    expect(detail.arpu).toBeNull();
  });

  it('builds a per-day series where revenue/cost align by date', async () => {
    const siteId = await seedSite('a');
    // April: hosting=30 → 1/day for 30 days
    await roiService.createSiteCost(deps(), siteId, {
      month: '2026-04-01',
      hostingUsd: 30,
    });
    await seedAdSenseDay(siteId, '2026-04-10', 5);
    const detail = await roiService.getSiteRoi(deps(), siteId, {
      from: '2026-04-10',
      to: '2026-04-12',
    });
    expect(detail.series).toHaveLength(3);
    expect(detail.series[0]).toMatchObject({
      date: '2026-04-10',
      revenue: 5,
      cost: 1,
      profit: 4,
    });
    expect(detail.series[1]).toMatchObject({ revenue: 0, cost: 1, profit: -1 });
  });

  it('flags negative_roi when cost > revenue', async () => {
    const siteId = await seedSite('a');
    await roiService.createSiteCost(deps(), siteId, {
      month: '2026-04-01',
      hostingUsd: 30,
    });
    await seedAdSenseDay(siteId, '2026-04-15', 1); // tiny revenue
    await seedMetricsDay(siteId, '2026-04-15', 100, 50);
    const detail = await roiService.getSiteRoi(deps(), siteId, {
      from: '2026-04-10',
      to: '2026-04-19',
    });
    expect(detail.flags).toContain('negative_roi');
  });
});

describe('roiService — getRoiTable', () => {
  it('returns one row per non-archived site, sorted by ROI ascending by default', async () => {
    const a = await seedSite('a', 'A');
    const b = await seedSite('b', 'B');
    const c = await seedSite('c', 'C');
    await roiService.createSiteCost(deps(), a, {
      month: '2026-04-01',
      hostingUsd: 30,
    });
    await roiService.createSiteCost(deps(), b, {
      month: '2026-04-01',
      hostingUsd: 30,
    });
    await roiService.createSiteCost(deps(), c, {
      month: '2026-04-01',
      hostingUsd: 30,
    });
    // a: revenue 5 → ROI -0.5, b: revenue 60 → ROI +1, c: revenue 30 → ROI 0
    await seedAdSenseDay(a, '2026-04-15', 5);
    await seedAdSenseDay(b, '2026-04-15', 60);
    await seedAdSenseDay(c, '2026-04-15', 30);

    const rows = await roiService.getRoiTable(deps(), {
      from: '2026-04-10',
      to: '2026-04-19',
    });
    expect(rows.map((r) => r.slug)).toEqual(['a', 'c', 'b']);
  });

  it('null ROI rows sink to the bottom regardless of sort key', async () => {
    const a = await seedSite('a', 'A');
    await seedSite('b', 'B');
    // a has cost+revenue, b has neither
    await roiService.createSiteCost(deps(), a, {
      month: '2026-04-01',
      hostingUsd: 30,
    });
    await seedAdSenseDay(a, '2026-04-15', 60);

    const rows = await roiService.getRoiTable(deps(), {
      from: '2026-04-10',
      to: '2026-04-19',
    });
    expect(rows[0]?.slug).toBe('a');
    expect(rows[1]?.slug).toBe('b');
    expect(rows[1]?.roi).toBeNull();
  });

  it('respects sortBy=revenue (descending) with stable slug tie-break', async () => {
    const a = await seedSite('a-tie', 'A');
    const b = await seedSite('b-tie', 'B');
    await seedAdSenseDay(a, '2026-04-15', 50);
    await seedAdSenseDay(b, '2026-04-15', 50); // tie

    const rows = await roiService.getRoiTable(
      deps(),
      { from: '2026-04-10', to: '2026-04-19' },
      'revenue',
    );
    // tie → slug ASC
    expect(rows.map((r) => r.slug)).toEqual(['a-tie', 'b-tie']);
  });

  it('omits archived sites from the table', async () => {
    await seedSite('alive');
    const archivedId = await seedSite('archived');
    await siteRepo.update(handle.db as never, archivedId, { status: 'archived' });

    const rows = await roiService.getRoiTable(deps(), {
      from: '2026-04-10',
      to: '2026-04-19',
    });
    expect(rows.map((r) => r.slug)).toEqual(['alive']);
  });
});

describe('roiService — getLowEfficiencySites', () => {
  it('returns only flagged sites and sorts by flag count then ROI', async () => {
    const a = await seedSite('a-bad', 'A');
    const b = await seedSite('b-fine', 'B');
    // a: negative ROI + low rpm (revenue 1, pv 5000, cost 30) → 2 flags
    await roiService.createSiteCost(deps(), a, {
      month: '2026-04-01',
      hostingUsd: 30,
    });
    await seedAdSenseDay(a, '2026-04-15', 1);
    await seedMetricsDay(a, '2026-04-15', 5000, 4000);
    // b: healthy
    await roiService.createSiteCost(deps(), b, {
      month: '2026-04-01',
      hostingUsd: 5,
    });
    await seedAdSenseDay(b, '2026-04-15', 100);
    await seedMetricsDay(b, '2026-04-15', 5000, 4000);

    const flagged = await roiService.getLowEfficiencySites(deps(), {
      from: '2026-04-10',
      to: '2026-04-19',
    });
    expect(flagged.map((r) => r.slug)).toEqual(['a-bad']);
    expect(flagged[0]?.flags.length).toBeGreaterThanOrEqual(2);
  });
});

describe('roiService — listSiteCosts', () => {
  it('returns rows for a single site newest-month-first', async () => {
    const a = await seedSite('a');
    void siteCostRepo;
    await roiService.createSiteCost(deps(), a, {
      month: '2026-02-01',
      hostingUsd: 5,
    });
    await roiService.createSiteCost(deps(), a, {
      month: '2026-04-01',
      hostingUsd: 5,
    });
    await roiService.createSiteCost(deps(), a, {
      month: '2026-03-01',
      hostingUsd: 5,
    });
    const list = await roiService.listSiteCosts(deps(), a);
    expect(list.map((r) => r.month)).toEqual(['2026-04-01', '2026-03-01', '2026-02-01']);
  });
});

describe('roiService — surfaces revenueService composition', () => {
  it('integrates affiliate revenue (spread across days) into ROI', async () => {
    const a = await seedSite('a');
    await roiService.createSiteCost(deps(), a, {
      month: '2026-04-01',
      hostingUsd: 30,
    });
    // 30-day affiliate $300 → $10/day; window covers 10 days → $100 affiliate
    await revenueService.createAffiliateEntry(deps(), a, {
      periodStart: '2026-04-01',
      periodEnd: '2026-04-30',
      program: 'Amazon',
      amountUsd: 300,
    });
    const detail = await roiService.getSiteRoi(deps(), a, {
      from: '2026-04-10',
      to: '2026-04-19',
    });
    // cost = 10, revenue (affiliate only) = 100 → ROI 9, profit 90
    expect(detail.revenue).toBeCloseTo(100, 4);
    expect(detail.cost).toBeCloseTo(10, 4);
    expect(detail.profit).toBeCloseTo(90, 4);
    expect(detail.roi).toBeCloseTo(9, 4);
    expect(detail.breakdown.affiliateRevenue).toBeCloseTo(100, 4);
  });
});
