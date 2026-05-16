import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/common/page-header';
import { DomainFilters } from '@/components/domains/domain-filters';
import { DomainList } from '@/components/domains/domain-list';

export const dynamic = 'force-dynamic';

export default async function DomainsPage() {
  const t = await getTranslations('pages.domains');
  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('description')} />
      <DomainFilters />
      <DomainList />
    </div>
  );
}
