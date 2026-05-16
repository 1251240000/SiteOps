import { CircleDollarSign, Coins, DollarSign, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { StatCard } from '@/components/common/stat-card';

export type RevenueKpiSummary = {
  adRevenue: number;
  affiliateRevenue: number;
  total: number;
  totalPrev: number;
  delta: number;
  topProgram: string | null;
  /** PV used by the ARPV calculation; pass `null` if PV is unavailable. */
  pv?: number | null;
};

const usdFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

const arpvFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 4,
  minimumFractionDigits: 2,
});

const pctFmt = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 1,
});

function pickTone(value: number): 'positive' | 'negative' | 'neutral' {
  if (value === 0) return 'neutral';
  return value > 0 ? 'positive' : 'negative';
}

function deltaText(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '—';
  const formatted = pctFmt.format(Math.abs(value));
  return value > 0 ? `↑ ${formatted}` : `↓ ${formatted}`;
}

/**
 * Four KPI cards for the revenue dashboard. ARPV (revenue per page view)
 * is rendered when `pv` is supplied; otherwise we show a contextual hint
 * so the operator knows why the cell is blank.
 */
export function RevenueKpiRow({ summary }: { summary: RevenueKpiSummary }) {
  const t = useTranslations('pages.revenue.kpis');
  const arpv = summary.pv && summary.pv > 0 ? summary.total / summary.pv : null;

  return (
    <section
      aria-label={t('ariaLabel')}
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
    >
      <StatCard
        label={t('totalRevenue')}
        value={usdFmt.format(summary.total)}
        icon={DollarSign}
        delta={{ value: deltaText(summary.delta), tone: pickTone(summary.delta) }}
        hint={t('prev', { value: usdFmt.format(summary.totalPrev) })}
      />
      <StatCard
        label={t('adSense')}
        value={usdFmt.format(summary.adRevenue)}
        icon={Coins}
        hint={
          summary.total === 0
            ? t('noRevenueWindow')
            : t('shareOfTotal', { percent: pctFmt.format(summary.adRevenue / summary.total) })
        }
      />
      <StatCard
        label={t('affiliate')}
        value={usdFmt.format(summary.affiliateRevenue)}
        icon={CircleDollarSign}
        hint={
          summary.topProgram
            ? t('topProgram', { name: summary.topProgram })
            : t('noAffiliateEntries')
        }
      />
      <StatCard
        label={t('arpv')}
        value={arpv === null ? '—' : arpvFmt.format(arpv)}
        icon={Sparkles}
        hint={
          arpv === null
            ? summary.pv === undefined
              ? t('pvNotLoaded')
              : t('noPvInWindow')
            : t('perPageView')
        }
      />
    </section>
  );
}
