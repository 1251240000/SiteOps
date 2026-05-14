import { notFound } from 'next/navigation';

import { isAppError, siteIdParamSchema } from '@siteops/shared';
import { sites as siteSvc } from '@siteops/services';

import { DeploymentTimeline } from '@/components/deployments/deployment-timeline';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function SiteDeploymentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = siteIdParamSchema.safeParse({ id });
  if (!parsed.success) notFound();

  try {
    // Verify the site exists so 404 here mirrors the rest of the tab routes.
    await siteSvc.siteService.getById({ db: getDb() }, parsed.data.id);
  } catch (err) {
    if (isAppError(err) && err.status === 404) notFound();
    throw err;
  }

  return <DeploymentTimeline siteId={parsed.data.id} />;
}
