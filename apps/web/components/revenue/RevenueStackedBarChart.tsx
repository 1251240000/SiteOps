'use client';

import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { cn } from '@/lib/utils';

export type RevenuePoint = {
  date: string;
  adRevenue: number;
  affiliateRevenue: number;
};

const usdFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const usdTooltip = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

type ChartMode = 'stacked' | 'lines';

/**
 * Recharts revenue chart.
 *
 * Defaults to a stacked bar (Ad + Affiliate) which makes the share split
 * obvious; a "Lines" toggle switches to two overlaid line series for
 * trend comparison. Ad uses the primary palette colour, affiliate uses
 * the warning palette so they're distinguishable in both light and dark
 * themes via `currentColor`.
 */
export function RevenueStackedBarChart({
  data,
  granularity,
}: {
  data: RevenuePoint[];
  granularity: 'day' | 'week';
}) {
  const [mode, setMode] = useState<ChartMode>('stacked');

  if (data.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 text-sm text-muted-foreground">
        No revenue data in the selected window.
      </div>
    );
  }

  return (
    <section
      aria-label="Revenue chart"
      className="space-y-3 rounded-lg border border-border bg-card p-4"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Revenue over time</h2>
        <div role="tablist" aria-label="Chart mode" className="flex gap-1">
          {(['stacked', 'lines'] as const).map((key) => {
            const active = mode === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setMode(key)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  active
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                )}
              >
                {key === 'stacked' ? 'Stacked' : 'Lines'}
              </button>
            );
          })}
        </div>
      </header>

      <div className="h-72 w-full text-foreground">
        <ResponsiveContainer width="100%" height="100%">
          {mode === 'stacked' ? (
            <BarChart data={data} margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="currentColor" strokeOpacity={0.08} vertical={false} />
              <XAxis
                dataKey="date"
                stroke="currentColor"
                strokeOpacity={0.4}
                tick={{ fill: 'currentColor', fillOpacity: 0.7, fontSize: 11 }}
                tickFormatter={(v: string) => formatBucket(v, granularity)}
                minTickGap={24}
              />
              <YAxis
                stroke="currentColor"
                strokeOpacity={0.4}
                tick={{ fill: 'currentColor', fillOpacity: 0.7, fontSize: 11 }}
                tickFormatter={(v: number) => usdFmt.format(v)}
                width={64}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                labelFormatter={(label: string) => formatBucket(label, granularity)}
                formatter={tooltipFormatter}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar
                dataKey="adRevenue"
                name="AdSense"
                stackId="rev"
                fill="hsl(var(--primary))"
                radius={[0, 0, 0, 0]}
                isAnimationActive={false}
              />
              <Bar
                dataKey="affiliateRevenue"
                name="Affiliate"
                stackId="rev"
                fill="hsl(var(--warning))"
                radius={[2, 2, 0, 0]}
                isAnimationActive={false}
              />
            </BarChart>
          ) : (
            <LineChart data={data} margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="currentColor" strokeOpacity={0.08} vertical={false} />
              <XAxis
                dataKey="date"
                stroke="currentColor"
                strokeOpacity={0.4}
                tick={{ fill: 'currentColor', fillOpacity: 0.7, fontSize: 11 }}
                tickFormatter={(v: string) => formatBucket(v, granularity)}
                minTickGap={24}
              />
              <YAxis
                stroke="currentColor"
                strokeOpacity={0.4}
                tick={{ fill: 'currentColor', fillOpacity: 0.7, fontSize: 11 }}
                tickFormatter={(v: number) => usdFmt.format(v)}
                width={64}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                labelFormatter={(label: string) => formatBucket(label, granularity)}
                formatter={tooltipFormatter}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line
                type="monotone"
                dataKey="adRevenue"
                name="AdSense"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="affiliateRevenue"
                name="Affiliate"
                stroke="hsl(var(--warning))"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </section>
  );
}

const tooltipStyle = {
  background: 'hsl(var(--card))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 6,
  color: 'hsl(var(--foreground))',
  fontSize: 12,
};

function tooltipFormatter(value: unknown, name: string): [string, string] {
  const num = typeof value === 'number' ? usdTooltip.format(value) : String(value);
  return [num, name];
}

function formatBucket(date: string, granularity: 'day' | 'week'): string {
  const month = date.slice(5, 7);
  const day = date.slice(8, 10);
  if (granularity === 'week') return `wk ${month}-${day}`;
  return `${month}-${day}`;
}
