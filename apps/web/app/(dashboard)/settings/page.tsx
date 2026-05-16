import { Settings as SettingsIcon } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { StatCard } from '@/components/common/stat-card';
import { auth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const [session, t, tTopbar] = await Promise.all([
    auth(),
    getTranslations('pages.settings'),
    getTranslations('topbar'),
  ]);
  const user = session?.user;
  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('description')} />

      <section className="grid gap-4 sm:grid-cols-2">
        <StatCard
          label={t('signedInAdmin')}
          value={user?.email ?? '—'}
          hint={user?.name ?? tTopbar('accountDefaultName')}
        />
        <StatCard label={t('themeLabel')} value={t('themeValue')} hint={t('themeHint')} />
      </section>

      <EmptyState icon={SettingsIcon} title={t('emptyTitle')} description={t('emptyDescription')} />
    </div>
  );
}
