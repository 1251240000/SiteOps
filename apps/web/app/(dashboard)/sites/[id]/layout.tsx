import { notFound } from 'next/navigation';
import { type ReactNode } from 'react';

import { siteIdParamSchema } from '@siteops/shared';
import { sites as siteSvc } from '@siteops/services';
import { isAppError } from '@siteops/shared';

import { PageHeader } from '@/components/common/page-header';
import { Badge } from '@/components/ui/badge';
import { getDb } from '@/lib/db';

import { SiteHeaderActions } from './header-actions';
import { SiteTabs } from './tabs';

type LayoutProps = {
  params: Promise<{ id: string }>;
  children: ReactNode;
};

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'muted'> = {
  active: 'success',
  paused: 'warning',
  archived: 'muted',
};

export default async function SiteDetailLayout({ params, children }: LayoutProps) {
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

  return (
    <div className="space-y-6">
      <PageHeader
        title={site.name}
        description={
          <span className="flex items-center gap-2">
            <Badge variant={STATUS_VARIANT[site.status] ?? 'outline'}>{site.status}</Badge>
            <Badge variant="outline">{site.siteType}</Badge>
            <a
              href={site.primaryUrl}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-xs hover:text-foreground"
            >
              {site.primaryUrl}
            </a>
          </span>
        }
        actions={<SiteHeaderActions site={site} />}
      />
      <SiteTabs siteId={site.id} />
      {children}
    </div>
  );
}
