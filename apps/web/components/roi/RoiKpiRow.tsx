import { Coins, DollarSign, TrendingUp } from 'lucide-react';

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
  return (
    <section aria-label="ROI KPIs" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Revenue" value={usdFmt.format(summary.revenue)} icon={DollarSign} />
      <StatCard
        label="Cost"
        value={usdFmt.format(summary.cost)}
        icon={Coins}
        hint={summary.cost === 0 ? 'No cost recorded' : undefined}
      />
      <StatCard
        label="Profit"
        value={usdFmt.format(summary.profit)}
        delta={{
          value: summary.profit >= 0 ? '↑ profit' : '↓ loss',
          tone: profitTone(summary.profit),
        }}
      />
      <StatCard
        label="ROI"
        value={summary.roi === null ? 'N/A' : roiFmt.format(summary.roi)}
        icon={TrendingUp}
        delta={
          summary.roi === null
            ? undefined
            : { value: summary.roi >= 0 ? '↑ in profit' : '↓ in loss', tone: roiTone(summary.roi) }
        }
        hint={summary.rpm === null ? 'No PV data' : `RPM ${rpmFmt.format(summary.rpm)}`}
      />
    </section>
  );
}
