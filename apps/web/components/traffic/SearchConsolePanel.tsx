import { Award, MousePointerClick, Search, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { StatCard } from '@/components/common/stat-card';

export type SearchSummaryValue = {
  impressions: number;
  clicks: number;
  ctr: number;
  avgPosition: number | null;
};

export type TopQueryRow = {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number | null;
};

const intFmt = new Intl.NumberFormat('en-US');
const pctFmt = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 2,
});
const posFmt = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

/**
 * Compact GSC view: 4 KPI cards + a top queries list. Designed to slot
 * underneath the chart on the per-site traffic page.
 */
export function SearchConsolePanel({
  summary,
  topQueries,
}: {
  summary: SearchSummaryValue;
  topQueries: TopQueryRow[];
}) {
  const t = useTranslations('pages.traffic.search');
  return (
    <section aria-label={t('ariaLabel')} className="space-y-4">
      <header className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
        <span className="text-xs text-muted-foreground">
          {t('queriesCount', { count: topQueries.length })}
        </span>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t('impressions')}
          value={intFmt.format(summary.impressions)}
          icon={Search}
        />
        <StatCard
          label={t('clicks')}
          value={intFmt.format(summary.clicks)}
          icon={MousePointerClick}
        />
        <StatCard
          label={t('ctr')}
          value={summary.impressions === 0 ? '—' : pctFmt.format(summary.ctr)}
          icon={Sparkles}
        />
        <StatCard
          label={t('avgPosition')}
          value={summary.avgPosition === null ? '—' : posFmt.format(summary.avgPosition)}
          icon={Award}
          hint={t('avgPositionHint')}
        />
      </div>

      {topQueries.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-muted/30 p-6 text-sm text-muted-foreground">
          {t('empty')}
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2 text-left font-medium">
                  {t('colQuery')}
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  {t('colClicks')}
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  {t('colImpressions')}
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  {t('colCtr')}
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  {t('colAvgPos')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-card">
              {topQueries.map((q) => (
                <tr key={q.query} className="hover:bg-muted/40">
                  <td className="max-w-[280px] truncate px-4 py-2">{q.query}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{intFmt.format(q.clicks)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {intFmt.format(q.impressions)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {q.impressions === 0 ? '—' : pctFmt.format(q.ctr)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {q.position === null ? '—' : posFmt.format(q.position)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
