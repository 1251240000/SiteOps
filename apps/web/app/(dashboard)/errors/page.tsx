import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/common/page-header';
import { ErrorList } from '@/components/errors/ErrorList';

export const dynamic = 'force-dynamic';

export default async function ErrorsPage() {
  const t = await getTranslations('pages.errors');
  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('description')} />
      <ErrorList />
    </div>
  );
}
