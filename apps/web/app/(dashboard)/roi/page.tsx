import { getTranslations } from 'next-intl/server';

import { roi as roiSvc } from '@siteops/services';

import { PageHeader } from '@/components/common/page-header';
import { DateRangePicker } from '@/components/traffic/DateRangePicker';
import { LowEfficiencyBanner, type LowEfficiencyFlag } from '@/components/roi/LowEfficiencyBanner';
import { RoiTable } from '@/components/roi/RoiTable';
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

const SORT_KEYS = ['roi', 'revenue', 'cost', 'profit', 'rpm', 'pv'] as const;
type SortKey = (typeof SORT_KEYS)[number];

function readSortBy(value: string | string[] | undefined): SortKey {
  const v = readScalar(value);
  return (SORT_KEYS as readonly string[]).includes(v ?? '') ? (v as SortKey) : 'roi';
}

/**
 * Global ROI dashboard.
 *
 * - Same date-range UX as the traffic / revenue dashboards.
 * - Banner at the top calls out sites that trip any low-efficiency rule.
 * - Table is sorted by ROI ascending (worst first) by default.
 */
export default async function RoiPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const range = resolveRange(readScalar(sp['from']), readScalar(sp['to']));
  const sortBy = readSortBy(sp['sortBy']);

  const db = getDb();
  const rows = await roiSvc.roiService.getRoiTable({ db }, range, sortBy);
  const flagged = rows.filter((r) => r.flags.length > 0);

  // Aggregate flag counts for the banner
  const flagCounts: Partial<Record<LowEfficiencyFlag, number>> = {};
  for (const row of flagged) {
    for (const flag of row.flags) {
      flagCounts[flag] = (flagCounts[flag] ?? 0) + 1;
    }
  }

  const t = await getTranslations('pages.roi');
  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        description={t('description', {
          from: range.from,
          to: range.to,
          count: rows.length,
          sortBy: t(`sortKeys.${sortBy}`),
        })}
      />

      <DateRangePicker />

      <LowEfficiencyBanner count={flagged.length} flagCounts={flagCounts} />

      <RoiTable rows={rows} />
    </div>
  );
}
