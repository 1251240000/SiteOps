'use client';

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { RevenuePoint } from './RevenueStackedBarChart';

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

/**
 * Plain line-chart variant of the revenue series.
 *
 * `RevenueStackedBarChart` already lets the user toggle into a line view;
 * this component is for cases where only the line shape is wanted (e.g.
 * the ROI page in T24, or future inline previews).
 */
export function RevenueLineChart({
  data,
  granularity,
  className,
}: {
  data: RevenuePoint[];
  granularity: 'day' | 'week';
  className?: string;
}) {
  if (data.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 text-sm text-muted-foreground">
        No revenue data in the selected window.
      </div>
    );
  }

  return (
    <div className={`h-72 w-full text-foreground ${className ?? ''}`.trim()}>
      <ResponsiveContainer width="100%" height="100%">
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
            contentStyle={{
              background: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              borderRadius: 6,
              color: 'hsl(var(--foreground))',
              fontSize: 12,
            }}
            labelFormatter={(label: string) => formatBucket(label, granularity)}
            formatter={(value: unknown, name: string) => [
              typeof value === 'number' ? usdTooltip.format(value) : String(value),
              name,
            ]}
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
      </ResponsiveContainer>
    </div>
  );
}

function formatBucket(date: string, granularity: 'day' | 'week'): string {
  const month = date.slice(5, 7);
  const day = date.slice(8, 10);
  if (granularity === 'week') return `wk ${month}-${day}`;
  return `${month}-${day}`;
}
