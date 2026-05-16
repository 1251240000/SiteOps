'use client';

import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

export type UptimeChartPoint = {
  bucket: string | Date;
  total: number;
  ok: number;
  avgResponseTimeMs: number | null;
};

/**
 * Lightweight inline SVG line chart. We deliberately do not pull a charting
 * library — the rendering is trivial and keeps the JS bundle thin.
 *
 * The chart shows the average response time per bucket; bars beneath colour
 * each bucket by ok-rate (green ≥99%, amber ≥95%, red otherwise).
 */
export function UptimeChart({ series }: { series: UptimeChartPoint[] }) {
  const t = useTranslations('pages.uptime.chart');
  const view = useMemo(() => {
    if (series.length === 0) return null;
    const times = series.map((p) => new Date(p.bucket).getTime());
    const xMin = Math.min(...times);
    const xMax = Math.max(...times);
    const responseTimes = series
      .map((p) => p.avgResponseTimeMs)
      .filter((v): v is number => typeof v === 'number');
    const yMax = Math.max(1, ...responseTimes);
    return { xMin, xMax: xMax === xMin ? xMin + 1 : xMax, yMax };
  }, [series]);

  if (!view || series.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 text-sm text-muted-foreground">
        {t('empty')}
      </div>
    );
  }

  const W = 800;
  const H = 160;
  const PAD = 16;
  const innerW = W - PAD * 2;
  const innerH = H - PAD * 2 - 14;
  const { xMin, xMax, yMax } = view;

  function x(t: number): number {
    return PAD + ((t - xMin) / (xMax - xMin)) * innerW;
  }
  function y(v: number): number {
    return PAD + (1 - v / yMax) * innerH;
  }

  const lineD = series
    .filter((p) => p.avgResponseTimeMs != null)
    .map((p, i) => {
      const px = x(new Date(p.bucket).getTime());
      const py = y(p.avgResponseTimeMs as number);
      return `${i === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`;
    })
    .join(' ');

  const bucketWidth = innerW / Math.max(1, series.length);
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <svg
        role="img"
        aria-label={t('ariaLabel')}
        viewBox={`0 0 ${W} ${H}`}
        className="h-40 w-full"
        preserveAspectRatio="none"
      >
        <text x={PAD} y={PAD - 2} fontSize={10} className="fill-muted-foreground">
          {t('maxLabel', { ms: view.yMax })}
        </text>
        {lineD ? <path d={lineD} fill="none" className="stroke-primary" strokeWidth={1.5} /> : null}
        {series.map((p, i) => {
          const okRate = p.total === 0 ? 1 : p.ok / p.total;
          const cls =
            okRate >= 0.99
              ? 'fill-success/60'
              : okRate >= 0.95
                ? 'fill-warning/60'
                : 'fill-destructive/60';
          const bx = PAD + bucketWidth * i;
          return (
            <rect
              key={i}
              x={bx}
              y={H - PAD - 8}
              width={Math.max(1, bucketWidth - 1)}
              height={6}
              className={cls}
            >
              <title>
                {t('tooltip', {
                  date: new Date(p.bucket).toISOString(),
                  ok: p.ok,
                  total: p.total,
                })}
              </title>
            </rect>
          );
        })}
      </svg>
    </div>
  );
}
