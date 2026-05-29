import { notFound } from 'next/navigation';

import { analytics as analyticsSvc, sites as siteSvc } from '@siteops/services';
import { isAppError, siteIdParamSchema } from '@siteops/shared';

import { AnalyticsSummary } from '@/components/analytics/AnalyticsSummary';
import { DateRangePicker } from '@/components/traffic/DateRangePicker';
import { getDb } from '@/lib/db';
import { resolveRange } from '@/lib/date-range';

export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function readScalar(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function SiteAnalyticsPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const parsed = siteIdParamSchema.safeParse({ id });
  if (!parsed.success) notFound();

  const sp = await searchParams;
  const range = resolveRange(readScalar(sp['from']), readScalar(sp['to']));
  const db = getDb();

  try {
    await siteSvc.siteService.getById({ db }, parsed.data.id);
    const overview = await analyticsSvc.analyticsAggregateService.getSiteOverview(
      db,
      parsed.data.id,
      range,
    );

    return (
      <div className="space-y-6">
        <DateRangePicker />
        <AnalyticsSummary overview={overview} />
      </div>
    );
  } catch (err) {
    if (isAppError(err) && err.status === 404) notFound();
    throw err;
  }
}
