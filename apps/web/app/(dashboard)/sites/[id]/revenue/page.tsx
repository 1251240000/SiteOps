import { notFound } from 'next/navigation';

import {
  metrics as metricsSvc,
  revenue as revenueSvc,
  roi as roiSvc,
  sites as siteSvc,
} from '@siteops/services';
import { isAppError, siteIdParamSchema } from '@siteops/shared';

import { DateRangePicker, resolveRange } from '@/components/traffic/DateRangePicker';
import { AffiliateEntriesTable } from '@/components/revenue/AffiliateEntriesTable';
import { RevenueKpiRow } from '@/components/revenue/RevenueKpiRow';
import { RevenueStackedBarChart } from '@/components/revenue/RevenueStackedBarChart';
import { RoiKpiRow } from '@/components/roi/RoiKpiRow';
import { SiteCostsSection } from '@/components/roi/SiteCostsSection';
import type { SiteCostRow } from '@/components/roi/SiteCostsTable';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  return readScalar(value) === 'week' ? 'week' : 'day';
}

function serializeEntry(row: {
  id: string;
  siteId: string;
  periodStart: string;
  periodEnd: string;
  program: string;
  amountUsd: string;
  amountRaw: string | null;
  currency: string | null;
  payoutDate: string | null;
  notes: string | null;
}): {
  id: string;
  siteId: string;
  periodStart: string;
  periodEnd: string;
  program: string;
  amountUsd: number;
  amountRaw: number | null;
  currency: string | null;
  payoutDate: string | null;
  notes: string | null;
} {
  return {
    id: row.id,
    siteId: row.siteId,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    program: row.program,
    amountUsd: Number(row.amountUsd),
    amountRaw: row.amountRaw === null ? null : Number(row.amountRaw),
    currency: row.currency,
    payoutDate: row.payoutDate,
    notes: row.notes,
  };
}

export default async function SiteRevenuePage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const parsed = siteIdParamSchema.safeParse({ id });
  if (!parsed.success) notFound();

  const sp = await searchParams;
  const range = resolveRange(readScalar(sp['from']), readScalar(sp['to']));
  const granularity = readGranularity(sp['granularity']);

  const db = getDb();
  const deps = { db };
  try {
    await siteSvc.siteService.getById({ db }, parsed.data.id);

    const [revSummary, revSeries, entries, programs, traffic, roiDetail, costs] = await Promise.all(
      [
        revenueSvc.revenueService.getSiteRevenueSummary(deps, parsed.data.id, range),
        revenueSvc.revenueService.getSiteRevenueSeries(deps, parsed.data.id, range, granularity),
        revenueSvc.revenueService.listAffiliateEntries(deps, parsed.data.id),
        revenueSvc.revenueService.listKnownPrograms(deps, parsed.data.id, 90),
        // Pull PV from the traffic service so ARPV is meaningful per site.
        metricsSvc.trafficService.getSiteSummary(db, parsed.data.id, range),
        roiSvc.roiService.getSiteRoi({ db }, parsed.data.id, range),
        roiSvc.roiService.listSiteCosts({ db }, parsed.data.id),
      ],
    );

    const initialCostRows: SiteCostRow[] = costs.map((c) => ({
      id: c.id,
      siteId: c.siteId,
      month: c.month,
      hostingUsd: c.hostingUsd,
      domainUsd: c.domainUsd,
      contentUsd: c.contentUsd,
      adsSpendUsd: c.adsSpendUsd,
      otherUsd: c.otherUsd,
      notes: c.notes,
    }));

    return (
      <div className="space-y-6">
        <DateRangePicker />

        <RoiKpiRow
          summary={{
            revenue: roiDetail.revenue,
            cost: roiDetail.cost,
            profit: roiDetail.profit,
            roi: roiDetail.roi,
            rpm: roiDetail.rpm,
          }}
        />

        <Tabs defaultValue="revenue" className="space-y-4">
          <TabsList>
            <TabsTrigger value="revenue">Revenue</TabsTrigger>
            <TabsTrigger value="costs">Costs</TabsTrigger>
          </TabsList>

          <TabsContent value="revenue" className="space-y-6">
            <RevenueKpiRow summary={{ ...revSummary, pv: traffic.pv }} />
            <RevenueStackedBarChart data={revSeries.points} granularity={revSeries.granularity} />
            <AffiliateEntriesTable
              siteId={parsed.data.id}
              initialEntries={entries.map(serializeEntry)}
              knownPrograms={programs}
            />
          </TabsContent>

          <TabsContent value="costs" className="space-y-6">
            <SiteCostsSection siteId={parsed.data.id} initialRows={initialCostRows} />
          </TabsContent>
        </Tabs>
      </div>
    );
  } catch (err) {
    if (isAppError(err) && err.status === 404) notFound();
    throw err;
  }
}
