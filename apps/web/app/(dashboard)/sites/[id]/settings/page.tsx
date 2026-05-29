import { notFound } from 'next/navigation';

import { siteIdParamSchema, isAppError } from '@siteops/shared';
import { sites as siteSvc } from '@siteops/services';

import { SiteForm } from '@/components/sites/site-form';
import { headers } from 'next/headers';
import { getDb } from '@/lib/db';

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

  const headerList = await headers();
  const proto =
    headerList.get('x-forwarded-proto') ??
    (process.env.NODE_ENV === 'production' ? 'https' : 'http');
  const host = headerList.get('x-forwarded-host') ?? headerList.get('host') ?? 'localhost:3000';
  const appOrigin = `${proto}://${host}`;

  return <SiteForm mode="edit" initial={site} appOrigin={appOrigin} />;
}
