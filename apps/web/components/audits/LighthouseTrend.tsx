'use client';

export type LhTrendPoint = {
  startedAt: string | Date;
  performance: number;
};

/** Tiny SVG sparkline for the last N performance scores. */
export function LighthouseTrend({ points }: { points: LhTrendPoint[] }) {
  if (points.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border bg-muted/30 p-6 text-sm text-muted-foreground">
        Run Lighthouse a few times to see a trend.
      </p>
    );
  }
  const W = 320;
  const H = 80;
  const PAD = 8;
  const xs = points.map((_, i) => i);
  const xMin = 0;
  const xMax = Math.max(1, xs.length - 1);
  const yMin = 0;
  const yMax = 1;
  function x(v: number): number {
    return PAD + ((v - xMin) / (xMax - xMin || 1)) * (W - PAD * 2);
  }
  function y(v: number): number {
    return PAD + (1 - (v - yMin) / (yMax - yMin)) * (H - PAD * 2);
  }
  const d = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.performance).toFixed(1)}`)
    .join(' ');
  const last = points[points.length - 1]!;
  return (
    <div className="flex items-end gap-3 rounded-lg border border-border bg-card p-4">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-20 w-full max-w-md">
        <path d={d} fill="none" className="stroke-primary" strokeWidth={1.5} />
      </svg>
      <div className="text-xs text-muted-foreground">
        <div>Latest</div>
        <div className="text-base font-semibold text-foreground">
          {Math.round(last.performance * 100)}
        </div>
      </div>
    </div>
  );
}
