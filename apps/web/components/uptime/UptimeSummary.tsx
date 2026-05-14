import { Activity, Clock, ShieldCheck } from 'lucide-react';

import { StatCard } from '@/components/common/stat-card';

export type UptimeSummaryValue = {
  okRate: number;
  total: number;
  ok: number;
  avgResponseTimeMs: number | null;
};

export function UptimeSummary({
  value,
  windowLabel,
}: {
  value: UptimeSummaryValue;
  windowLabel: string;
}) {
  const pct = (value.okRate * 100).toFixed(value.okRate >= 0.999 ? 2 : 1);
  return (
    <section aria-label="Uptime summary" className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <StatCard
        label={`Uptime · ${windowLabel}`}
        value={`${pct}%`}
        icon={ShieldCheck}
        hint={`${value.ok} ok / ${value.total} checks`}
      />
      <StatCard
        label="Avg response"
        value={value.avgResponseTimeMs == null ? '—' : `${value.avgResponseTimeMs} ms`}
        icon={Clock}
        hint="Across the same window"
      />
      <StatCard
        label="Failed checks"
        value={`${value.total - value.ok}`}
        icon={Activity}
        hint={
          value.total === 0
            ? 'No data yet'
            : `${(((value.total - value.ok) / value.total) * 100).toFixed(1)}% of window`
        }
      />
    </section>
  );
}
