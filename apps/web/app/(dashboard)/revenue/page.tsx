import { getTranslations } from 'next-intl/server';

import { revenue as revenueSvc } from '@siteops/services';

import { PageHeader } from '@/components/common/page-header';
import { DateRangePicker } from '@/components/traffic/DateRangePicker';
import { RevenueKpiRow } from '@/components/revenue/RevenueKpiRow';
import { RevenueStackedBarChart } from '@/components/revenue/RevenueStackedBarChart';
import { TopRevenueSitesTable } from '@/components/revenue/TopRevenueSitesTable';
import { getDb } from '@/lib/db';
import { resolveRange } from '@/lib/date-range';

export const dynamic = 'force-dynamic';

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function readScalar(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function readGranularity(value: string | string[] | undefined): 'day' | 'week' {
  return readScalar(value) === 'week' ? 'week' : 'day';
}

/**
 * Global revenue dashboard. Mirrors the traffic page layout: filters →
 * KPIs → chart → top-N table. Per-site drill-down lives at
 * `/sites/[id]/revenue` and links from the table.
 */
export default async function RevenuePage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const range = resolveRange(readScalar(sp['from']), readScalar(sp['to']));
  const granularity = readGranularity(sp['granularity']);

  const db = getDb();
  const deps = { db };
  const [summary, series, topSites, t] = await Promise.all([
    revenueSvc.revenueService.getGlobalRevenueSummary(deps, range),
    revenueSvc.revenueService.getGlobalRevenueSeries(deps, range, granularity),
    revenueSvc.revenueService.getTopRevenueSites(deps, range, 10),
    getTranslations('pages.revenue'),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        description={t('description', { from: range.from, to: range.to, granularity })}
      />

      <DateRangePicker />

      <RevenueKpiRow summary={summary} />

      <RevenueStackedBarChart data={series.points} granularity={series.granularity} />

      <TopRevenueSitesTable rows={topSites} />
    </div>
  );
}
