import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/common/page-header';
import { IntegrationsGrid } from '@/components/integrations/IntegrationsGrid';

export const dynamic = 'force-dynamic';

export default async function IntegrationsPage() {
  const t = await getTranslations('pages.integrations');
  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('description')} />
      <IntegrationsGrid />
    </div>
  );
}
