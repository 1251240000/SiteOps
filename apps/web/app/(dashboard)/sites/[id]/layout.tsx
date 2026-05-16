import { getTranslations } from 'next-intl/server';
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

const KNOWN_STATUS = ['active', 'paused', 'archived'] as const;
type KnownStatus = (typeof KNOWN_STATUS)[number];
const KNOWN_TYPE = ['directory', 'tool', 'content', 'forum', 'landing'] as const;
type KnownType = (typeof KNOWN_TYPE)[number];

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

  const tStatus = await getTranslations('enums.siteStatus');
  const tType = await getTranslations('enums.siteType');
  const statusLabel = (KNOWN_STATUS as readonly string[]).includes(site.status)
    ? tStatus(site.status as KnownStatus)
    : site.status;
  const typeLabel = (KNOWN_TYPE as readonly string[]).includes(site.siteType)
    ? tType(site.siteType as KnownType)
    : site.siteType;

  return (
    <div className="space-y-6">
      <PageHeader
        title={site.name}
        description={
          <span className="flex items-center gap-2">
            <Badge variant={STATUS_VARIANT[site.status] ?? 'outline'}>{statusLabel}</Badge>
            <Badge variant="outline">{typeLabel}</Badge>
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
