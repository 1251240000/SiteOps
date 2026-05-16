import { Coins, DollarSign, TrendingUp } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { StatCard } from '@/components/common/stat-card';

export type RoiKpiSummary = {
  revenue: number;
  cost: number;
  profit: number;
  roi: number | null;
  rpm: number | null;
};

const usdFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

const roiFmt = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 1,
});

const rpmFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

function profitTone(value: number): 'positive' | 'negative' | 'neutral' {
  if (value > 0) return 'positive';
  if (value < 0) return 'negative';
  return 'neutral';
}

function roiTone(value: number | null): 'positive' | 'negative' | 'neutral' {
  if (value === null) return 'neutral';
  if (value > 0) return 'positive';
  if (value < 0) return 'negative';
  return 'neutral';
}

/**
 * Single-site ROI KPI row. Shown above the per-site revenue chart so an
 * operator immediately sees whether the site is profitable in the
 * selected window.
 */
export function RoiKpiRow({ summary }: { summary: RoiKpiSummary }) {
  const t = useTranslations('pages.roi.kpis');
  return (
    <section
      aria-label={t('ariaLabel')}
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
    >
      <StatCard label={t('revenue')} value={usdFmt.format(summary.revenue)} icon={DollarSign} />
      <StatCard
        label={t('cost')}
        value={usdFmt.format(summary.cost)}
        icon={Coins}
        hint={summary.cost === 0 ? t('costNoneHint') : undefined}
      />
      <StatCard
        label={t('profit')}
        value={usdFmt.format(summary.profit)}
        delta={{
          value: summary.profit >= 0 ? t('profitUp') : t('profitDown'),
          tone: profitTone(summary.profit),
        }}
      />
      <StatCard
        label={t('roi')}
        value={summary.roi === null ? t('naValue') : roiFmt.format(summary.roi)}
        icon={TrendingUp}
        delta={
          summary.roi === null
            ? undefined
            : {
                value: summary.roi >= 0 ? t('roiInProfit') : t('roiInLoss'),
                tone: roiTone(summary.roi),
              }
        }
        hint={
          summary.rpm === null ? t('noPvData') : t('rpmHint', { value: rpmFmt.format(summary.rpm) })
        }
      />
    </section>
  );
}
