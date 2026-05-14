/**
 * ROI service.
 *
 * Composes `trafficService` (PV / UV) + `revenueService` (Ad + Affiliate
 * total) + `site_costs` (manual cost entries) into a single per-site
 * ROI view used by the ROI dashboard.
 *
 * Why compose, not re-query:
 *   - revenueService already knows how to spread affiliate periods, sum
 *     prior windows, etc. Re-implementing that here would split the
 *     "what counts as revenue?" definition into two places.
 *   - When T23 grows new revenue sources (e.g. Stripe in M5), this
 *     service automatically picks them up.
 *
 * Cost amortisation:
 *   - Each `site_costs` row covers a calendar month. We split it across
 *     the days the month overlaps the request window using
 *     `dailyCost = monthlyTotal / daysInThatMonth`. No caching — at
 *     <= 50 sites × <= 90 days the work is negligible.
 *
 * Sorting:
 *   - `sortBy` is a closed enum ('roi'|'revenue'|'cost'|'rpm'|'pv'),
 *     resolved via switch in JS (the data set is fully materialised in
 *     memory before we sort, so no SQL injection surface). Secondary
 *     sort is `slug ASC` for stable ordering across reloads.
 */
import { type Db, type SiteCost, siteCostRepo, siteRepo } from '@siteops/db';
import {
  AppError,
  addDays,
  type CreateSiteCostInput,
  createSiteCostSchema,
  enumerateBuckets,
  formatIsoDate,
  type Logger,
  type UpdateSiteCostInput,
  updateSiteCostSchema,
} from '@siteops/shared';

import { trafficService } from '../metrics/traffic-service.js';
import { revenueService } from '../revenue/revenue-service.js';

import { evaluateRules, type LowEfficiencyFlag } from './rules.js';

export type DateRange = {
  from: string;
  to: string;
};

export type RoiSortBy = 'roi' | 'revenue' | 'cost' | 'profit' | 'rpm' | 'pv';

export type SiteCostBreakdown = {
  hostingCost: number;
  domainCost: number;
  contentCost: number;
  adsSpendCost: number;
  otherCost: number;
};

export type RoiRow = {
  siteId: string;
  slug: string;
  name: string;
  status: 'active' | 'paused' | 'archived';
  pv: number;
  uv: number;
  revenue: number;
  cost: number;
  profit: number;
  /** null when totalCost == 0 (no cost data → ROI undefined). */
  roi: number | null;
  /** null when pv == 0. */
  rpm: number | null;
  /** null when uv == 0. */
  arpu: number | null;
  flags: LowEfficiencyFlag[];
};

export type SiteRoiDetail = RoiRow & {
  breakdown: {
    adRevenue: number;
    affiliateRevenue: number;
  } & SiteCostBreakdown;
  series: Array<{ date: string; revenue: number; cost: number; profit: number }>;
};

export type RoiServiceDeps = {
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

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function rangeDays(range: DateRange): number {
  const fromTs = Date.parse(`${range.from}T00:00:00.000Z`);
  const toTs = Date.parse(`${range.to}T00:00:00.000Z`);
  return Math.floor((toTs - fromTs) / MS_PER_DAY) + 1;
}

/** Number of days in the calendar month that contains `monthStart`. */
function daysInMonth(monthStart: string): number {
  // monthStart is `YYYY-MM-01`. The 0th day of the next month is the last day of `monthStart`.
  const [y, m] = monthStart.split('-').map(Number);
  if (!y || !m) return 30;
  // `Date.UTC(y, m, 0)` gives the last day of month `m` (1-indexed → 0 day of next).
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Compute days the month [monthStart, monthEnd] intersects [from, to] (inclusive). */
function intersectionDays(monthStart: string, range: DateRange): number {
  const monthEndTs = Date.UTC(Number(monthStart.slice(0, 4)), Number(monthStart.slice(5, 7)), 0);
  const monthStartTs = Date.parse(`${monthStart}T00:00:00.000Z`);
  const fromTs = Date.parse(`${range.from}T00:00:00.000Z`);
  const toTs = Date.parse(`${range.to}T00:00:00.000Z`);
  const startTs = Math.max(monthStartTs, fromTs);
  const endTs = Math.min(monthEndTs, toTs);
  if (endTs < startTs) return 0;
  return Math.floor((endTs - startTs) / MS_PER_DAY) + 1;
}

/**
 * Spread a single `site_costs` row across the days of its month that
 * overlap `range`, returning the per-column dollar contributions.
 *
 * Returns zeros for every column when the month does not overlap.
 */
function spreadCostToBreakdown(cost: SiteCost, range: DateRange): SiteCostBreakdown {
  const overlapDays = intersectionDays(cost.month, range);
  const monthDays = daysInMonth(cost.month);
  const ratio = monthDays === 0 ? 0 : overlapDays / monthDays;
  return {
    hostingCost: num(cost.hostingUsd) * ratio,
    domainCost: num(cost.domainUsd) * ratio,
    contentCost: num(cost.contentUsd) * ratio,
    adsSpendCost: num(cost.adsSpendUsd) * ratio,
    otherCost: num(cost.otherUsd) * ratio,
  };
}

function emptyBreakdown(): SiteCostBreakdown {
  return {
    hostingCost: 0,
    domainCost: 0,
    contentCost: 0,
    adsSpendCost: 0,
    otherCost: 0,
  };
}

function sumBreakdown(b: SiteCostBreakdown): number {
  return b.hostingCost + b.domainCost + b.contentCost + b.adsSpendCost + b.otherCost;
}

function addBreakdown(a: SiteCostBreakdown, b: SiteCostBreakdown): SiteCostBreakdown {
  return {
    hostingCost: a.hostingCost + b.hostingCost,
    domainCost: a.domainCost + b.domainCost,
    contentCost: a.contentCost + b.contentCost,
    adsSpendCost: a.adsSpendCost + b.adsSpendCost,
    otherCost: a.otherCost + b.otherCost,
  };
}

function roundBreakdown(b: SiteCostBreakdown): SiteCostBreakdown {
  return {
    hostingCost: round4(b.hostingCost),
    domainCost: round4(b.domainCost),
    contentCost: round4(b.contentCost),
    adsSpendCost: round4(b.adsSpendCost),
    otherCost: round4(b.otherCost),
  };
}

function computeRoiMetrics(input: { pv: number; uv: number; revenue: number; cost: number }): {
  roi: number | null;
  rpm: number | null;
  arpu: number | null;
  profit: number;
} {
  const profit = input.revenue - input.cost;
  const roi = input.cost > 0 ? profit / input.cost : null;
  const rpm = input.pv > 0 ? (input.revenue / input.pv) * 1000 : null;
  const arpu = input.uv > 0 ? input.revenue / input.uv : null;
  return { roi, rpm, arpu, profit };
}

function compareForSort(a: RoiRow, b: RoiRow, sortBy: RoiSortBy): number {
  const pick = (r: RoiRow): number | null => {
    switch (sortBy) {
      case 'roi':
        return r.roi;
      case 'revenue':
        return r.revenue;
      case 'cost':
        return r.cost;
      case 'profit':
        return r.profit;
      case 'rpm':
        return r.rpm;
      case 'pv':
        return r.pv;
    }
  };
  const av = pick(a);
  const bv = pick(b);
  // null values sink to the bottom regardless of direction so admins can
  // see the "real" data first.
  if (av === null && bv === null) return a.slug.localeCompare(b.slug);
  if (av === null) return 1;
  if (bv === null) return -1;
  // ROI is sorted ascending by default ("worst first"); everything else
  // descending. Tie-break on slug ASC for stability.
  if (sortBy === 'roi') {
    if (av === bv) return a.slug.localeCompare(b.slug);
    return av - bv;
  }
  if (av === bv) return a.slug.localeCompare(b.slug);
  return bv - av;
}

export const roiService = {
  // ---------- write surface (site_costs) --------------------------------

  async createSiteCost(deps: RoiServiceDeps, siteId: string, rawInput: unknown): Promise<SiteCost> {
    const parsed = createSiteCostSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new AppError('Invalid site cost', {
        code: 'validation_failed',
        status: 400,
        details: parsed.error.flatten(),
      });
    }
    const input: CreateSiteCostInput = parsed.data;

    // Pre-check the unique key so the route returns a structured 409
    // regardless of which Postgres driver / wrapper surfaces the
    // constraint message. The DB-level UNIQUE INDEX is still the final
    // arbiter against any race.
    const existing = await siteCostRepo.getByMonth(deps.db, siteId, input.month);
    if (existing) {
      throw new AppError('A cost row already exists for that month', {
        code: 'conflict',
        status: 409,
        details: { siteId, month: input.month },
      });
    }

    const created = await siteCostRepo.create(deps.db, {
      siteId,
      month: input.month,
      hostingUsd: input.hostingUsd,
      domainUsd: input.domainUsd,
      contentUsd: input.contentUsd,
      adsSpendUsd: input.adsSpendUsd,
      otherUsd: input.otherUsd,
      notes: input.notes ?? null,
    });
    deps.logger?.info(
      { event: 'site-cost.created', costId: created.id, siteId, month: created.month },
      'site cost created',
    );
    return created;
  },

  async updateSiteCost(deps: RoiServiceDeps, id: string, rawPatch: unknown): Promise<SiteCost> {
    const parsed = updateSiteCostSchema.safeParse(rawPatch);
    if (!parsed.success) {
      throw new AppError('Invalid site cost patch', {
        code: 'validation_failed',
        status: 400,
        details: parsed.error.flatten(),
      });
    }
    const patch: UpdateSiteCostInput = parsed.data;
    // The repo layer expects each optional key either omitted or set to a
    // concrete value (not `undefined`). With `exactOptionalPropertyTypes`
    // we have to rebuild the object explicitly rather than spread.
    const updated = await siteCostRepo.update(deps.db, id, {
      ...(patch.month !== undefined ? { month: patch.month } : {}),
      ...(patch.hostingUsd !== undefined ? { hostingUsd: patch.hostingUsd } : {}),
      ...(patch.domainUsd !== undefined ? { domainUsd: patch.domainUsd } : {}),
      ...(patch.contentUsd !== undefined ? { contentUsd: patch.contentUsd } : {}),
      ...(patch.adsSpendUsd !== undefined ? { adsSpendUsd: patch.adsSpendUsd } : {}),
      ...(patch.otherUsd !== undefined ? { otherUsd: patch.otherUsd } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    });
    if (!updated) {
      throw new AppError('Site cost not found', {
        code: 'not_found',
        status: 404,
        details: { id },
      });
    }
    if (
      updated.updatedAt.getTime() === updated.createdAt.getTime() &&
      Object.keys(patch).length > 0
    ) {
      // PGlite (test) has no triggers; bump manually.
      updated.updatedAt = new Date();
    }
    deps.logger?.info(
      { event: 'site-cost.updated', costId: id, fields: Object.keys(patch) },
      'site cost updated',
    );
    return updated;
  },

  async deleteSiteCost(deps: RoiServiceDeps, id: string): Promise<void> {
    const removed = await siteCostRepo.delete(deps.db, id);
    if (!removed) {
      throw new AppError('Site cost not found', {
        code: 'not_found',
        status: 404,
        details: { id },
      });
    }
    deps.logger?.info({ event: 'site-cost.deleted', costId: id }, 'site cost deleted');
  },

  async getSiteCost(deps: RoiServiceDeps, id: string): Promise<SiteCost> {
    const row = await siteCostRepo.getById(deps.db, id);
    if (!row) {
      throw new AppError('Site cost not found', {
        code: 'not_found',
        status: 404,
        details: { id },
      });
    }
    return row;
  },

  async listSiteCosts(
    deps: RoiServiceDeps,
    siteId: string,
    opts: { limit?: number } = {},
  ): Promise<SiteCost[]> {
    return siteCostRepo.listForSite(deps.db, siteId, opts);
  },

  // ---------- read surface (computed) -----------------------------------

  /**
   * Per-site ROI detail used by `/sites/[id]/revenue` (extends the same
   * row used in the global table with a breakdown + day series).
   */
  async getSiteRoi(deps: RoiServiceDeps, siteId: string, range: DateRange): Promise<SiteRoiDetail> {
    const site = await siteRepo.getById(deps.db, siteId);
    if (!site) {
      throw new AppError('Site not found', {
        code: 'not_found',
        status: 404,
        details: { id: siteId },
      });
    }

    const [traffic, revenue, costs, revenueSeries] = await Promise.all([
      trafficService.getSiteSummary(deps.db, siteId, range),
      revenueService.getSiteRevenueSummary({ db: deps.db }, siteId, range),
      siteCostRepo.listOverlapping(deps.db, range, siteId),
      revenueService.getSiteRevenueSeries({ db: deps.db }, siteId, range, 'day'),
    ]);

    let breakdown: SiteCostBreakdown = emptyBreakdown();
    for (const cost of costs) {
      breakdown = addBreakdown(breakdown, spreadCostToBreakdown(cost, range));
    }
    const totalCost = sumBreakdown(breakdown);
    const totalRevenue = revenue.total;
    const metrics = computeRoiMetrics({
      pv: traffic.pv,
      uv: traffic.uv,
      revenue: totalRevenue,
      cost: totalCost,
    });

    const flags = evaluateRules({
      roi: metrics.roi,
      rpm: metrics.rpm,
      pv: traffic.pv,
      revenue: totalRevenue,
      revenuePrev: revenue.totalPrev,
      windowDays: rangeDays(range),
    });

    // Per-day cost series: walk each day, find any matching month, divide.
    const days = enumerateBuckets(range.from, range.to, 'day');
    const costByDay = new Map<string, number>();
    for (const day of days) {
      let perDay = 0;
      for (const cost of costs) {
        if (
          day.slice(0, 7) === cost.month.slice(0, 7) // same calendar month
        ) {
          const dim = daysInMonth(cost.month);
          const monthlyTotal =
            num(cost.hostingUsd) +
            num(cost.domainUsd) +
            num(cost.contentUsd) +
            num(cost.adsSpendUsd) +
            num(cost.otherUsd);
          perDay += dim === 0 ? 0 : monthlyTotal / dim;
        }
      }
      costByDay.set(day, perDay);
    }

    const revenueByDay = new Map<string, number>();
    for (const p of revenueSeries.points) {
      revenueByDay.set(p.date, num(p.adRevenue) + num(p.affiliateRevenue));
    }

    const series = days.map((date) => {
      const r = revenueByDay.get(date) ?? 0;
      const c = costByDay.get(date) ?? 0;
      return {
        date,
        revenue: round4(r),
        cost: round4(c),
        profit: round4(r - c),
      };
    });

    return {
      siteId: site.id,
      slug: site.slug,
      name: site.name,
      status: site.status,
      pv: traffic.pv,
      uv: traffic.uv,
      revenue: round4(totalRevenue),
      cost: round4(totalCost),
      profit: round4(metrics.profit),
      roi: metrics.roi === null ? null : round4(metrics.roi),
      rpm: metrics.rpm === null ? null : round4(metrics.rpm),
      arpu: metrics.arpu === null ? null : round4(metrics.arpu),
      flags,
      breakdown: {
        adRevenue: round4(revenue.adRevenue),
        affiliateRevenue: round4(revenue.affiliateRevenue),
        ...roundBreakdown(breakdown),
      },
      series,
    };
  },

  /**
   * Cross-site ROI table. Iterates the active+paused sites and composes
   * the existing services per-row. At <= 50 sites this finishes well
   * inside the per-request budget; beyond that we'd switch to a single
   * SQL JOIN (see task notes).
   */
  async getRoiTable(
    deps: RoiServiceDeps,
    range: DateRange,
    sortBy: RoiSortBy = 'roi',
  ): Promise<RoiRow[]> {
    const allSites = await siteRepo.list(deps.db, { limit: 100 });
    const sites = allSites.items.filter((s) => s.status !== 'archived');

    const rows = await Promise.all(
      sites.map(async (site): Promise<RoiRow> => {
        const [traffic, revenue, costs] = await Promise.all([
          trafficService.getSiteSummary(deps.db, site.id, range),
          revenueService.getSiteRevenueSummary({ db: deps.db }, site.id, range),
          siteCostRepo.listOverlapping(deps.db, range, site.id),
        ]);
        let breakdown: SiteCostBreakdown = emptyBreakdown();
        for (const c of costs) {
          breakdown = addBreakdown(breakdown, spreadCostToBreakdown(c, range));
        }
        const totalCost = sumBreakdown(breakdown);
        const totalRevenue = revenue.total;
        const metrics = computeRoiMetrics({
          pv: traffic.pv,
          uv: traffic.uv,
          revenue: totalRevenue,
          cost: totalCost,
        });
        const flags = evaluateRules({
          roi: metrics.roi,
          rpm: metrics.rpm,
          pv: traffic.pv,
          revenue: totalRevenue,
          revenuePrev: revenue.totalPrev,
          windowDays: rangeDays(range),
        });
        return {
          siteId: site.id,
          slug: site.slug,
          name: site.name,
          status: site.status,
          pv: traffic.pv,
          uv: traffic.uv,
          revenue: round4(totalRevenue),
          cost: round4(totalCost),
          profit: round4(metrics.profit),
          roi: metrics.roi === null ? null : round4(metrics.roi),
          rpm: metrics.rpm === null ? null : round4(metrics.rpm),
          arpu: metrics.arpu === null ? null : round4(metrics.arpu),
          flags,
        };
      }),
    );

    return rows.sort((a, b) => compareForSort(a, b, sortBy));
  },

  /**
   * Subset of `getRoiTable` whose `flags` is non-empty. Sorted with the
   * "most flags first, then ROI ascending" convention so the operator
   * sees the worst-offending sites at the top.
   */
  async getLowEfficiencySites(deps: RoiServiceDeps, range: DateRange): Promise<RoiRow[]> {
    const all = await this.getRoiTable(deps, range, 'roi');
    return all
      .filter((r) => r.flags.length > 0)
      .sort((a, b) => {
        if (a.flags.length !== b.flags.length) return b.flags.length - a.flags.length;
        return compareForSort(a, b, 'roi');
      });
  },
};

export { addDays, formatIsoDate };
