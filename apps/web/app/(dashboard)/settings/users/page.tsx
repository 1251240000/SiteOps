import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/common/page-header';
import { InviteUserDialog } from '@/components/users/InviteUserDialog';
import { UsersTable } from '@/components/users/UsersTable';
import { auth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * `/settings/users` — admin-only team management. Non-admins are redirected
 * to the dashboard so this page never appears to them, even if they construct
 * the URL by hand. The API does the same gate via `requirePermission`.
 */
export default async function UsersPage() {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (role !== 'admin') {
    redirect('/');
  }
  const t = await getTranslations('pages.users');
  const currentUserId = session?.user?.id ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={<InviteUserDialog />}
      />
      <UsersTable currentUserId={currentUserId} />
    </div>
  );
}
