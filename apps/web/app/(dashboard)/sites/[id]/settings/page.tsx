import { notFound } from 'next/navigation';
import { headers } from 'next/headers';

import { siteIdParamSchema, isAppError } from '@siteops/shared';
import { sites as siteSvc } from '@siteops/services';

import { SiteForm } from '@/components/sites/site-form';
import { getDb } from '@/lib/db';
import { resolvePublicAppOrigin } from '@/lib/public-origin';

export const dynamic = 'force-dynamic';

export default async function SiteSettingsPage({ params }: { params: Promise<{ id: string }> }) {
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

  const appOrigin = resolvePublicAppOrigin(await headers());

  return <SiteForm mode="edit" initial={site} appOrigin={appOrigin} />;
}
