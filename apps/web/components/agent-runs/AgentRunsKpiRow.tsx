'use client';

import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle, KeyRound, Timer } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { StatCard } from '@/components/common/stat-card';
import { Skeleton } from '@/components/ui/skeleton';
import { api, type ApiError, type ApiSuccess } from '@/lib/api-client';
import { agentRunsKeys, type AgentRunSummary } from '@/lib/queries/agent-runs';
import { cn } from '@/lib/utils';

function pctText(failed: number, total: number): string {
  if (total === 0) return '0%';
  const pct = (failed / total) * 100;
  return `${pct.toFixed(pct < 10 ? 1 : 0)}%`;
}

function msText(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

/**
 * Four-up KPI cards for the `/agent-runs` dashboard.
 *
 * Always queries the *same* date window the table uses (via `from`/`to`
 * props); the parent page wires the URL state through so the cards and
 * the table stay in sync.
 */
export function AgentRunsKpiRow({ from, to }: { from?: string; to?: string }) {
  const t = useTranslations('pages.agentRuns.kpi');
  const query = useMemo(() => {
    const out: Record<string, string> = {};
    if (from) out['from'] = from;
    if (to) out['to'] = to;
    return out;
  }, [from, to]);

  const { data, isLoading, error } = useQuery<ApiSuccess<AgentRunSummary>, ApiError>({
    queryKey: agentRunsKeys.summary(query),
    queryFn: () => api.get<AgentRunSummary>('/agent-runs/summary', { query }),
  });

  const s = data?.data;
  const total = s?.total ?? 0;
  const failed = s?.failed ?? 0;
  const failedPct = pctText(failed, total);
  const failedTone: 'positive' | 'negative' | 'neutral' =
    total === 0 ? 'neutral' : failed === 0 ? 'positive' : 'negative';

  return (
    <section
      aria-label={t('ariaLabel')}
      className={cn('grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4')}
    >
      <StatCard
        label={t('total')}
        value={isLoading ? <Skeleton className="h-7 w-16" /> : total.toLocaleString()}
        icon={Activity}
        hint={error ? t('loadFailed') : t('windowHint')}
      />
      <StatCard
        label={t('failureRate')}
        value={isLoading ? <Skeleton className="h-7 w-16" /> : failedPct}
        delta={{
          value: t('failedCount', { count: failed }),
          tone: failedTone,
        }}
        icon={AlertTriangle}
      />
      <StatCard
        label={t('p95Latency')}
        value={isLoading ? <Skeleton className="h-7 w-20" /> : msText(s?.p95DurationMs ?? null)}
        icon={Timer}
        hint={s?.p50DurationMs != null ? t('p50Hint', { ms: msText(s.p50DurationMs) }) : null}
      />
      <StatCard
        label={t('activeKeys')}
        value={isLoading ? <Skeleton className="h-7 w-12" /> : (s?.activeKeys ?? 0).toString()}
        icon={KeyRound}
      />
    </section>
  );
}
