'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { cn } from '@/lib/utils';

export type TrafficSeriesPoint = {
  date: string;
  pv: number;
  uv: number;
  sessions: number;
};

type MetricKey = 'pv' | 'uv' | 'sessions';
type Metric = {
  key: MetricKey;
  /** Tailwind colour token used in the legend pill. */
  color: string;
};

const METRICS: ReadonlyArray<Metric> = [
  { key: 'pv', color: 'text-primary' },
  { key: 'uv', color: 'text-success' },
  { key: 'sessions', color: 'text-warning' },
];

const intFmt = new Intl.NumberFormat('en-US');

/**
 * Recharts line chart with a metric switcher. We intentionally drive
 * stroke colour off `currentColor` (set on the wrapping `<span>`) so the
 * theme palette controls the chart hue — no hard-coded RGB values, and
 * dark mode just works via Tailwind tokens.
 */
export function TrafficLineChart({
  data,
  granularity,
}: {
  data: TrafficSeriesPoint[];
  granularity: 'day' | 'week';
}) {
  const t = useTranslations('pages.traffic.chart');
  const tMetric = useTranslations('pages.traffic.chart.metric');
  const [active, setActive] = useState<MetricKey>('pv');

  if (data.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 text-sm text-muted-foreground">
        {t('empty')}
      </div>
    );
  }

  const tickFormatter = (v: string): string => formatBucket(v, granularity, t);

  return (
    <section
      aria-label={t('ariaLabel')}
      className="space-y-3 rounded-lg border border-border bg-card p-4"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
        <div role="tablist" aria-label={t('metricAriaLabel')} className="flex flex-wrap gap-1">
          {METRICS.map((m) => {
            const isActive = m.key === active;
            return (
              <button
                key={m.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActive(m.key)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  isActive
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                )}
              >
                <span
                  className={cn('inline-block size-2 rounded-full bg-current', m.color)}
                  aria-hidden
                />
                {tMetric(m.key)}
              </button>
            );
          })}
        </div>
      </header>

      <div className={cn('h-72 w-full', METRICS.find((m) => m.key === active)?.color)}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="currentColor" strokeOpacity={0.08} vertical={false} />
            <XAxis
              dataKey="date"
              stroke="currentColor"
              strokeOpacity={0.4}
              tick={{ fill: 'currentColor', fillOpacity: 0.7, fontSize: 11 }}
              tickFormatter={tickFormatter}
              minTickGap={24}
            />
            <YAxis
              stroke="currentColor"
              strokeOpacity={0.4}
              tick={{ fill: 'currentColor', fillOpacity: 0.7, fontSize: 11 }}
              tickFormatter={(v: number) => intFmt.format(v)}
              width={56}
            />
            <Tooltip
              contentStyle={{
                background: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                borderRadius: 6,
                color: 'hsl(var(--foreground))',
                fontSize: 12,
              }}
              labelFormatter={(label: string) => formatBucket(label, granularity, t)}
              formatter={(value: unknown) =>
                typeof value === 'number' ? intFmt.format(value) : String(value)
              }
            />
            <Line
              type="monotone"
              dataKey={active}
              stroke="currentColor"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function formatBucket(
  date: string,
  granularity: 'day' | 'week',
  t: (key: 'weekBucket' | 'dayBucket', values: { date: string }) => string,
): string {
  // Both `day` and `week` buckets are anchored to a real date in the SQL
  // aggregation; "week of <date>" is the conventional UX presentation.
  const month = date.slice(5, 7);
  const day = date.slice(8, 10);
  const formatted = `${month}-${day}`;
  return t(granularity === 'week' ? 'weekBucket' : 'dayBucket', { date: formatted });
}
