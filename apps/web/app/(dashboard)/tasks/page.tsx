import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/common/page-header';
import { TasksKpiRow } from '@/components/tasks/TasksKpiRow';
import { TasksTable } from '@/components/tasks/TasksTable';

export const dynamic = 'force-dynamic';

/**
 * `/tasks` — admin view of the agent task queue (T25).
 *
 * Read-only KPI cards + filterable table. The "create task" path is
 * intentionally not surfaced here: enqueue happens upstream (cron, rule
 * engine, or a future composer page); this page is for triage.
 */
export default async function TasksPage() {
  const t = await getTranslations('pages.tasks');

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('description')} />
      <TasksKpiRow />
      <TasksTable />
    </div>
  );
}
