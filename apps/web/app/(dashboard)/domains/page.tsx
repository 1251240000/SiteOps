import { PageHeader } from '@/components/common/page-header';
import { DomainFilters } from '@/components/domains/domain-filters';
import { DomainList } from '@/components/domains/domain-list';

export const dynamic = 'force-dynamic';

export default function DomainsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Domains"
        description="DNS / registrar / SSL expiry across every site. Rows expiring within 30 days are highlighted; rows already expired are red."
      />
      <DomainFilters />
      <DomainList />
    </div>
  );
}
