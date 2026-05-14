import { Eye, Timer, Users, Zap } from 'lucide-react';

import { StatCard } from '@/components/common/stat-card';

export type TrafficKpiSummary = {
  pv: number;
  uv: number;
  sessions: number;
  avgSessionSec: number | null;
  bounceRate: number | null;
  pvPrev: number;
  uvPrev: number;
  sessionsPrev: number;
  delta: { pv: number; uv: number; sessions: number };
};

const intFmt = new Intl.NumberFormat('en-US');
const pctFmt = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 1,
  minimumFractionDigits: 0,
});

function pickTone(
  value: number,
  opts: { invert?: boolean } = {},
): 'positive' | 'negative' | 'neutral' {
  if (value === 0) return 'neutral';
  const positive = opts.invert ? value < 0 : value > 0;
  return positive ? 'positive' : 'negative';
}

function deltaText(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '—';
  const formatted = pctFmt.format(Math.abs(value));
  if (value > 0) return `↑ ${formatted}`;
  return `↓ ${formatted}`;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds - m * 60);
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

/**
 * Four KPI cards: page views, unique visitors, sessions, and average
 * session length. Each card surfaces the same-window prior-period delta
 * so operators can spot regressions without doing the math themselves.
 */
export function TrafficKpiRow({ summary }: { summary: TrafficKpiSummary }) {
  return (
    <section
      aria-label="Traffic KPIs"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
    >
      <StatCard
        label="Page views"
        value={intFmt.format(summary.pv)}
        icon={Eye}
        delta={{ value: deltaText(summary.delta.pv), tone: pickTone(summary.delta.pv) }}
        hint={`prev ${intFmt.format(summary.pvPrev)}`}
      />
      <StatCard
        label="Unique visitors"
        value={intFmt.format(summary.uv)}
        icon={Users}
        delta={{ value: deltaText(summary.delta.uv), tone: pickTone(summary.delta.uv) }}
        hint={`prev ${intFmt.format(summary.uvPrev)}`}
      />
      <StatCard
        label="Sessions"
        value={intFmt.format(summary.sessions)}
        icon={Zap}
        delta={{ value: deltaText(summary.delta.sessions), tone: pickTone(summary.delta.sessions) }}
        hint={`prev ${intFmt.format(summary.sessionsPrev)}`}
      />
      <StatCard
        label="Avg. session"
        value={formatDuration(summary.avgSessionSec)}
        icon={Timer}
        hint={
          summary.bounceRate === null
            ? 'No bounce data'
            : `bounce ${pctFmt.format(summary.bounceRate)}`
        }
      />
    </section>
  );
}
