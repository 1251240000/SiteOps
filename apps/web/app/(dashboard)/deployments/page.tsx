import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/common/page-header';
import { DeploymentFilters } from '@/components/deployments/deployment-filters';
import { DeploymentList } from '@/components/deployments/deployment-list';

export const dynamic = 'force-dynamic';

export default async function DeploymentsPage() {
  const t = await getTranslations('pages.deployments');
  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('description')} />
      <DeploymentFilters />
      <DeploymentList />
    </div>
  );
}
