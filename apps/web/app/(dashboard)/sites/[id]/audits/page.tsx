import { notFound } from 'next/navigation';

import { audits as auditsSvc } from '@siteops/services';
import { isAppError, siteIdParamSchema } from '@siteops/shared';

import { AuditList } from '@/components/audits/AuditList';
import { getDb } from '@/lib/db';

import { TriggerAudit } from './trigger';

export const dynamic = 'force-dynamic';

type PageProps = { params: Promise<{ id: string }> };

export default async function SiteAuditsPage({ params }: PageProps) {
  const { id } = await params;
  const parsed = siteIdParamSchema.safeParse({ id });
  if (!parsed.success) notFound();

  try {
    const runs = await auditsSvc.auditService.listRuns(
      { db: getDb() },
      { filters: { siteId: parsed.data.id }, limit: 20 },
    );
    return (
      <div className="space-y-6">
        <div className="flex justify-end">
          <TriggerAudit siteId={parsed.data.id} />
        </div>
        <AuditList
          siteId={parsed.data.id}
          items={runs.items.map((r) => ({
            id: r.id,
            auditType: r.auditType,
            status: r.status,
            startedAt: r.startedAt,
            finishedAt: r.finishedAt,
            score: r.score,
          }))}
        />
      </div>
    );
  } catch (err) {
    if (isAppError(err) && err.status === 404) notFound();
    throw err;
  }
}
