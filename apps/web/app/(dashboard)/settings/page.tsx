import { Settings as SettingsIcon } from 'lucide-react';

import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { StatCard } from '@/components/common/stat-card';
import { auth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const session = await auth();
  const user = session?.user;
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Profile, API keys, and notification preferences." />

      <section className="grid gap-4 sm:grid-cols-2">
        <StatCard label="Signed-in admin" value={user?.email ?? '—'} hint={user?.name ?? 'Admin'} />
        <StatCard label="Theme" value="Auto" hint="Pick light/dark from the top-right switcher." />
      </section>

      <EmptyState
        icon={SettingsIcon}
        title="More settings coming soon"
        description="API key management lands together with T25 (Agent task queue) and the notification channels page is part of T16."
      />
    </div>
  );
}
