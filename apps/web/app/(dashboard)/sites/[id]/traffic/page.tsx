import { notFound } from 'next/navigation';

import { metrics as metricsSvc, sites as siteSvc } from '@siteops/services';
import { isAppError, siteIdParamSchema } from '@siteops/shared';

import { DateRangePicker, resolveRange } from '@/components/traffic/DateRangePicker';
import { SearchConsolePanel } from '@/components/traffic/SearchConsolePanel';
import { TrafficKpiRow } from '@/components/traffic/TrafficKpiRow';
import { TrafficLineChart } from '@/components/traffic/TrafficLineChart';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ id: string }>;
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

export default async function SiteTrafficPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const parsed = siteIdParamSchema.safeParse({ id });
  if (!parsed.success) notFound();

  const sp = await searchParams;
  const range = resolveRange(readScalar(sp['from']), readScalar(sp['to']));
  const granularity = readGranularity(sp['granularity']);

  const db = getDb();
  try {
    // Fail fast with 404 if the site itself is missing — keeps the UX
    // consistent with the other tabs (`/uptime`, `/audits`, ...).
    await siteSvc.siteService.getById({ db }, parsed.data.id);

    const [summary, series, gscSummary, topQueries] = await Promise.all([
      metricsSvc.trafficService.getSiteSummary(db, parsed.data.id, range),
      metricsSvc.trafficService.getSiteSeries(db, parsed.data.id, range, granularity),
      metricsSvc.trafficService.getSiteSearchSummary(db, parsed.data.id, range),
      metricsSvc.trafficService.getSiteTopQueries(db, parsed.data.id, range, 10),
    ]);

    return (
      <div className="space-y-6">
        <DateRangePicker />

        <TrafficKpiRow summary={summary} />

        <TrafficLineChart data={series.points} granularity={series.granularity} />

        <SearchConsolePanel summary={gscSummary} topQueries={topQueries} />
      </div>
    );
  } catch (err) {
    if (isAppError(err) && err.status === 404) notFound();
    throw err;
  }
}
