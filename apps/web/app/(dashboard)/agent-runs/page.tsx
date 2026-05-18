import { getTranslations } from 'next-intl/server';

import { AgentRunsFilters } from '@/components/agent-runs/AgentRunsFilters';
import { AgentRunsKpiRow } from '@/components/agent-runs/AgentRunsKpiRow';
import { AgentRunsTable } from '@/components/agent-runs/AgentRunsTable';
import { PageHeader } from '@/components/common/page-header';
import { DateRangePicker } from '@/components/traffic/DateRangePicker';

export const dynamic = 'force-dynamic';

type Search = { from?: string; to?: string };

/**
 * `/agent-runs` — admin-only audit ledger view.
 *
 * Server component composes the four pieces (KPI row + filters + table).
 * URL state ownership:
 *   - `from` / `to`               → `<DateRangePicker />`
 *   - `status` / `action` / `agentName` → `<AgentRunsFilters />`
 *   - `page`                      → `<AgentRunsTable />` paginator
 *   - `id`                        → `<AgentRunDetailsDrawer />` mounted by the table
 */
export default async function AgentRunsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const t = await getTranslations('pages.agentRuns');
  const sp = await searchParams;

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('description')} />
      <DateRangePicker defaultDays={7} />
      <AgentRunsKpiRow from={sp.from} to={sp.to} />
      <AgentRunsFilters />
      <AgentRunsTable />
    </div>
  );
}
