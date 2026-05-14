import { metrics as metricsSvc } from '@siteops/services';

import { PageHeader } from '@/components/common/page-header';
import { DateRangePicker, resolveRange } from '@/components/traffic/DateRangePicker';
import { TopSitesTable } from '@/components/traffic/TopSitesTable';
import { TrafficKpiRow } from '@/components/traffic/TrafficKpiRow';
import { TrafficLineChart } from '@/components/traffic/TrafficLineChart';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function readScalar(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function readGranularity(value: string | string[] | undefined): 'day' | 'week' {
  const raw = readScalar(value);
  return raw === 'week' ? 'week' : 'day';
}

function readMetric(value: string | string[] | undefined): 'pv' | 'uv' | 'sessions' {
  const raw = readScalar(value);
  if (raw === 'uv' || raw === 'sessions') return raw;
  return 'pv';
}

/**
 * Global traffic dashboard. All queries flow through `trafficService` so
 * the same payload shape is reused by the per-site page and (later) the
 * `/api/v1/metrics/*` endpoints when an Agent calls them with a Bearer
 * key.
 */
export default async function TrafficPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const range = resolveRange(readScalar(sp['from']), readScalar(sp['to']));
  const granularity = readGranularity(sp['granularity']);
  const metric = readMetric(sp['metric']);

  const db = getDb();
  const [summary, series, topSites] = await Promise.all([
    metricsSvc.trafficService.getGlobalSummary(db, range),
    metricsSvc.trafficService.getGlobalSeries(db, range, granularity),
    metricsSvc.trafficService.getTopSites(db, range, metric, 10),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Traffic"
        description={`Global ${range.from} → ${range.to} · ${granularity === 'week' ? 'weekly' : 'daily'} buckets`}
      />

      <DateRangePicker />

      <TrafficKpiRow summary={summary} />

      <TrafficLineChart data={series.points} granularity={series.granularity} />

      <TopSitesTable rows={topSites} metric={metric} />
    </div>
  );
}
