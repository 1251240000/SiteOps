import { AlertTriangle, Globe, Rocket, ServerCog } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

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
export default async function OverviewPage() {
  const t = await getTranslations('pages.overview');
  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('description')} />

      <section
        aria-label={t('kpiAriaLabel')}
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <StatCard label={t('sitesTracked')} value="—" icon={Globe} hint={t('sitesTrackedHint')} />
        <StatCard label={t('domainsLabel')} value="—" icon={ServerCog} hint={t('domainsHint')} />
        <StatCard
          label={t('deploymentsLabel')}
          value="—"
          icon={Rocket}
          hint={t('deploymentsHint')}
        />
        <StatCard
          label={t('openAlerts')}
          value="—"
          icon={AlertTriangle}
          hint={t('openAlertsHint')}
        />
      </section>

      <section aria-label={t('recentActivityAriaLabel')} className="space-y-3">
        <header className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-foreground">{t('recentActivity')}</h2>
          <span className="text-xs text-muted-foreground">{t('recentActivityHint')}</span>
        </header>
        <ActivityTable />
      </section>

      <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />
    </div>
  );
}
