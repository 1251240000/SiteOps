import { Plus } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

import { PageHeader } from '@/components/common/page-header';
import { SiteFilters } from '@/components/sites/site-filters';
import { SiteList } from '@/components/sites/site-list';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

export default async function SitesPage() {
  const t = await getTranslations('pages.sites');
  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Button asChild>
            <Link href="/sites/new">
              <Plus className="size-4" /> {t('newAction')}
            </Link>
          </Button>
        }
      />
      <SiteFilters />
      <SiteList />
    </div>
  );
}
