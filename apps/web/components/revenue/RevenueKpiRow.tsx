import { CircleDollarSign, Coins, DollarSign, Sparkles } from 'lucide-react';

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
  const arpv = summary.pv && summary.pv > 0 ? summary.total / summary.pv : null;

  return (
    <section
      aria-label="Revenue KPIs"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
    >
      <StatCard
        label="Total revenue"
        value={usdFmt.format(summary.total)}
        icon={DollarSign}
        delta={{ value: deltaText(summary.delta), tone: pickTone(summary.delta) }}
        hint={`prev ${usdFmt.format(summary.totalPrev)}`}
      />
      <StatCard
        label="AdSense"
        value={usdFmt.format(summary.adRevenue)}
        icon={Coins}
        hint={
          summary.total === 0
            ? 'No revenue this window'
            : `${pctFmt.format(summary.adRevenue / summary.total)} of total`
        }
      />
      <StatCard
        label="Affiliate"
        value={usdFmt.format(summary.affiliateRevenue)}
        icon={CircleDollarSign}
        hint={summary.topProgram ? `top: ${summary.topProgram}` : 'No affiliate entries'}
      />
      <StatCard
        label="ARPV"
        value={arpv === null ? '—' : arpvFmt.format(arpv)}
        icon={Sparkles}
        hint={
          arpv === null
            ? summary.pv === undefined
              ? 'PV not loaded'
              : 'No PV in window'
            : 'per page view'
        }
      />
    </section>
  );
}
