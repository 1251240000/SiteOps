'use client';

import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, ListChecks, PauseCircle, XCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { StatCard } from '@/components/common/stat-card';
import { Skeleton } from '@/components/ui/skeleton';
import { api, type ApiError } from '@/lib/api-client';
import { tasksKeys, type TaskRow, type TaskStatus } from '@/lib/queries/tasks';

async function countByStatus(status: TaskStatus): Promise<number> {
  const res = await api.get<TaskRow[]>('/tasks', {
    query: { status, page: 1, limit: 1 },
  });
  const meta = res.meta as { total?: number } | undefined;
  return meta?.total ?? 0;
}

export function TasksKpiRow() {
  const t = useTranslations('pages.tasks.kpi');

  const queued = useQuery<{ total: number }, ApiError>({
    queryKey: tasksKeys.list({ kpi: 'queued' }),
    queryFn: async () => ({ total: await countByStatus('queued') }),
  });
  const claimed = useQuery<{ total: number }, ApiError>({
    queryKey: tasksKeys.list({ kpi: 'claimed' }),
    queryFn: async () => ({ total: await countByStatus('claimed') }),
  });
  const failed = useQuery<{ total: number }, ApiError>({
    queryKey: tasksKeys.list({ kpi: 'failed' }),
    queryFn: async () => ({ total: await countByStatus('failed') }),
  });
  const succeeded = useQuery<{ total: number }, ApiError>({
    queryKey: tasksKeys.list({ kpi: 'succeeded' }),
    queryFn: async () => ({ total: await countByStatus('succeeded') }),
  });

  function v(q: typeof queued): React.ReactNode {
    if (q.isLoading) return <Skeleton className="h-7 w-12" />;
    if (q.error) return '—';
    return (q.data?.total ?? 0).toLocaleString();
  }

  return (
    <section
      aria-label={t('ariaLabel')}
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
    >
      <StatCard label={t('queued')} value={v(queued)} icon={ListChecks} />
      <StatCard label={t('claimed')} value={v(claimed)} icon={PauseCircle} />
      <StatCard label={t('failed')} value={v(failed)} icon={XCircle} />
      <StatCard label={t('succeeded')} value={v(succeeded)} icon={CheckCircle2} />
    </section>
  );
}
