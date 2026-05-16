import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/common/page-header';
import { SiteForm } from '@/components/sites/site-form';

export const dynamic = 'force-dynamic';

export default async function NewSitePage() {
  const t = await getTranslations('pages.sites.new');
  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('description')} />
      <SiteForm mode="create" />
    </div>
  );
}
