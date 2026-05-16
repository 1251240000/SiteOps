import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { siteIdParamSchema } from '@siteops/shared';
import { sites as siteSvc } from '@siteops/services';
import { isAppError } from '@siteops/shared';

import { EmptyState } from '@/components/common/empty-state';
import { DomainCard } from '@/components/domains/domain-card';
import { SiteSummary } from '@/components/sites/site-summary';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function SiteOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = siteIdParamSchema.safeParse({ id });
  if (!parsed.success) notFound();

  let site;
  try {
    site = await siteSvc.siteService.getById({ db: getDb() }, parsed.data.id);
  } catch (err) {
    if (isAppError(err) && err.status === 404) notFound();
    throw err;
  }

  const t = await getTranslations('pages.sites.detail');
  return (
    <div className="space-y-6">
      <SiteSummary site={site} />
      <DomainCard siteId={site.id} />
      <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />
    </div>
  );
}
