import { Plus } from 'lucide-react';
import Link from 'next/link';

import { PageHeader } from '@/components/common/page-header';
import { SiteFilters } from '@/components/sites/site-filters';
import { SiteList } from '@/components/sites/site-list';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

export default function SitesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Sites"
        description="Registry of every site this dashboard manages."
        actions={
          <Button asChild>
            <Link href="/sites/new">
              <Plus className="size-4" /> New site
            </Link>
          </Button>
        }
      />
      <SiteFilters />
      <SiteList />
    </div>
  );
}
