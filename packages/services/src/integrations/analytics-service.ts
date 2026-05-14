/**
 * Analytics integration service (GA4 + Plausible).
 *
 * The two providers share a common upsert path (`metrics_daily`) but have
 * very different transports, so we expose three methods:
 *   - syncGa4(siteId, propertyId, serviceAccount, range)
 *   - syncPlausible(siteId, siteDomain, apiKey, range)
 *   - syncAll() — iterates active sites and dispatches based on
 *                `analyticsProvider`
 */

import { integrationStateRepo, metricsRepo, siteRepo, type Db, type Site } from '@siteops/db';
import { ga4, plausible } from '@siteops/integrations';
import type { Logger } from '@siteops/shared';

export type AnalyticsServiceDeps = {
  db: Db;
  logger?: Pick<Logger, 'info' | 'warn' | 'error'>;
  /** Inject for tests. */
  ga4Factory?: (sa: ga4.GoogleServiceAccount) => ga4.Ga4Client;
  plausibleFactory?: (apiKey: string) => plausible.PlausibleClient;
  /** Defaults to today (yyyy-mm-dd). */
  now?: () => Date;
};

export type AnalyticsRange = { startDate: string; endDate: string };

export type AnalyticsSyncSummary = {
  siteId: string;
  provider: 'ga4' | 'plausible';
  daysWritten: number;
  error?: string;
};

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function defaultGa4(sa: ga4.GoogleServiceAccount): ga4.Ga4Client {
  return new ga4.Ga4Client({ serviceAccount: sa });
}

function defaultPlausible(apiKey: string): plausible.PlausibleClient {
  return new plausible.PlausibleClient({ apiKey });
}

function defaultRange(now: Date, days = 2): AnalyticsRange {
  const end = ymd(now);
  const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return { startDate: ymd(startDate), endDate: end };
}

const GA4_METRICS = [
  { name: 'sessions' },
  { name: 'screenPageViews' },
  { name: 'totalUsers' },
  { name: 'bounceRate' },
  { name: 'averageSessionDuration' },
];

function safeNum(value: string | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export const analyticsService = {
  async syncGa4(
    deps: AnalyticsServiceDeps,
    site: Pick<Site, 'id' | 'analyticsId'>,
    serviceAccount: ga4.GoogleServiceAccount,
    range?: AnalyticsRange,
  ): Promise<AnalyticsSyncSummary> {
    if (!site.analyticsId) throw new Error('syncGa4: site missing analyticsId');
    const now = (deps.now ?? (() => new Date()))();
    const r = range ?? defaultRange(now);
    const summary: AnalyticsSyncSummary = {
      siteId: site.id,
      provider: 'ga4',
      daysWritten: 0,
    };
    try {
      const client = (deps.ga4Factory ?? defaultGa4)(serviceAccount);
      const report = await client.runReport(site.analyticsId, {
        dateRanges: [{ startDate: r.startDate, endDate: r.endDate }],
        dimensions: [{ name: 'date' }],
        metrics: GA4_METRICS,
      });
      const rows = report.rows ?? [];
      for (const row of rows) {
        const dateRaw = row.dimensionValues?.[0]?.value;
        if (!dateRaw || !/^\d{8}$/.test(dateRaw)) continue;
        const date = `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`;
        const [sessions, pv, uv, bounceRate, avgSessionSec] = row.metricValues ?? [];
        await metricsRepo.upsertMetricDaily(deps.db, {
          siteId: site.id,
          date,
          sessions: safeNum(sessions?.value),
          pv: safeNum(pv?.value),
          uv: safeNum(uv?.value),
          bounceRate: bounceRate?.value ? Number(bounceRate.value) : null,
          avgSessionSec: avgSessionSec?.value ? Math.round(Number(avgSessionSec.value)) : null,
        });
        summary.daysWritten += 1;
      }
      await integrationStateRepo.markSuccess(deps.db, 'ga4', site.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      summary.error = msg;
      await integrationStateRepo.markError(deps.db, 'ga4', site.id, msg);
      deps.logger?.warn(
        { event: 'ga4.site_sync_failed', siteId: site.id, err: { message: msg } },
        'ga4 site sync failed',
      );
    }
    deps.logger?.info(
      { event: 'ga4.site_sync', siteId: site.id, days: summary.daysWritten },
      'ga4 site sync done',
    );
    return summary;
  },

  async syncPlausible(
    deps: AnalyticsServiceDeps,
    site: Pick<Site, 'id' | 'primaryUrl'>,
    apiKey: string,
    range?: AnalyticsRange,
  ): Promise<AnalyticsSyncSummary> {
    const now = (deps.now ?? (() => new Date()))();
    const r = range ?? defaultRange(now);
    let host: string;
    try {
      host = new URL(site.primaryUrl).hostname.replace(/^www\./, '');
    } catch {
      throw new Error('syncPlausible: invalid primaryUrl');
    }
    const summary: AnalyticsSyncSummary = {
      siteId: site.id,
      provider: 'plausible',
      daysWritten: 0,
    };
    try {
      const client = (deps.plausibleFactory ?? defaultPlausible)(apiKey);
      const days = await client.timeseries(host, { start: r.startDate, end: r.endDate });
      for (const day of days) {
        if (!day.date) continue;
        await metricsRepo.upsertMetricDaily(deps.db, {
          siteId: site.id,
          date: day.date,
          pv: day.pageviews,
          uv: day.visitors,
          sessions: day.visits,
          bounceRate: day.bounce_rate ? day.bounce_rate / 100 : null,
          avgSessionSec: day.visit_duration ?? null,
        });
        summary.daysWritten += 1;
      }
      await integrationStateRepo.markSuccess(deps.db, 'plausible', site.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      summary.error = msg;
      await integrationStateRepo.markError(deps.db, 'plausible', site.id, msg);
      deps.logger?.warn(
        { event: 'plausible.site_sync_failed', siteId: site.id, err: { message: msg } },
        'plausible site sync failed',
      );
    }
    deps.logger?.info(
      { event: 'plausible.site_sync', siteId: site.id, days: summary.daysWritten },
      'plausible site sync done',
    );
    return summary;
  },

  async syncAll(
    deps: AnalyticsServiceDeps,
    inputs: { ga4ServiceAccount?: ga4.GoogleServiceAccount; plausibleApiKey?: string },
  ): Promise<AnalyticsSyncSummary[]> {
    const all = await siteRepo.list(deps.db, { limit: 100, filters: { status: 'active' } });
    const out: AnalyticsSyncSummary[] = [];
    for (const site of all.items) {
      if (site.analyticsProvider === 'ga4' && site.analyticsId && inputs.ga4ServiceAccount) {
        out.push(await this.syncGa4(deps, site, inputs.ga4ServiceAccount));
      } else if (site.analyticsProvider === 'plausible' && inputs.plausibleApiKey) {
        out.push(await this.syncPlausible(deps, site, inputs.plausibleApiKey));
      }
    }
    deps.logger?.info(
      { event: 'analytics.sync_all', sites: out.length },
      'analytics bulk sync finished',
    );
    return out;
  },
};
