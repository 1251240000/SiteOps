import { AlertTriangle, Globe, Rocket, ServerCog } from 'lucide-react';

import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { StatCard } from '@/components/common/stat-card';

import { ActivityTable } from './_demo/activity-table';

export const dynamic = 'force-dynamic';

/**
 * Dashboard home — KPI placeholders + a TanStack-Table demo (fake data)
 * that satisfies T07's DataTable acceptance and previews what `/sites` and
 * `/deployments` will look like once T08+ wire real data through.
 */
export default function OverviewPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        description="Cross-site KPI snapshot. Real data lands in T08+."
      />

      <section
        aria-label="Key metrics"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <StatCard label="Sites tracked" value="—" icon={Globe} hint="0 active · 0 archived" />
        <StatCard label="Domains" value="—" icon={ServerCog} hint="0 expiring < 30d" />
        <StatCard label="Deployments (7d)" value="—" icon={Rocket} hint="awaiting T10" />
        <StatCard label="Open alerts" value="—" icon={AlertTriangle} hint="awaiting T16" />
      </section>

      <section aria-label="Recent activity" className="space-y-3">
        <header className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-foreground">Recent activity</h2>
          <span className="text-xs text-muted-foreground">Preview · fake data</span>
        </header>
        <ActivityTable />
      </section>

      <EmptyState
        title="Nothing else yet"
        description="The remaining widgets (uptime sparkline, error rate, traffic) plug in during M2."
      />
    </div>
  );
}
