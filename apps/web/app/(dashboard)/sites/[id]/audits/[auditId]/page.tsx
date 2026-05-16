import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { audits as auditsSvc } from '@siteops/services';
import { idSchema, isAppError, siteIdParamSchema } from '@siteops/shared';

import { FindingsTable } from '@/components/audits/FindingsTable';
import { Badge } from '@/components/ui/badge';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

type PageProps = { params: Promise<{ id: string; auditId: string }> };

const KNOWN_STATUS = ['success', 'running', 'failed', 'unknown'] as const;
type KnownStatus = (typeof KNOWN_STATUS)[number];

export default async function SiteAuditDetailPage({ params }: PageProps) {
  const { id, auditId } = await params;
  const parsedSite = siteIdParamSchema.safeParse({ id });
  const parsedAudit = idSchema.safeParse(auditId);
  if (!parsedSite.success || !parsedAudit.success) notFound();

  const deps = { db: getDb() };
  const t = await getTranslations('pages.audits.detail');
  const tStatus = await getTranslations('enums.auditStatus');
  try {
    const run = await auditsSvc.auditService.getRun(deps, parsedAudit.data);
    const findings = await auditsSvc.auditService.listFindings(deps, parsedAudit.data);
    const statusLabel =
      run.status == null
        ? '—'
        : (KNOWN_STATUS as readonly string[]).includes(run.status)
          ? tStatus(run.status as KnownStatus)
          : run.status;
    return (
      <div className="space-y-4">
        <section className="rounded-lg border border-border bg-card p-4">
          <header className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">{t('summary')}</h2>
            <Badge variant="outline">{run.auditType}</Badge>
          </header>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">{t('status')}</dt>
              <dd>{statusLabel}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('score')}</dt>
              <dd className="font-semibold">
                {run.score == null ? '—' : t('scoreFormat', { score: run.score })}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('started')}</dt>
              <dd className="font-mono text-xs">
                {run.startedAt ? new Date(run.startedAt).toISOString() : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('finished')}</dt>
              <dd className="font-mono text-xs">
                {run.finishedAt ? new Date(run.finishedAt).toISOString() : '—'}
              </dd>
            </div>
          </dl>
        </section>

        <FindingsTable
          items={findings.map((f) => ({
            id: f.id,
            code: f.code,
            severity: f.severity,
            title: f.title,
            message: f.message,
            url: f.url,
          }))}
        />
      </div>
    );
  } catch (err) {
    if (isAppError(err) && err.status === 404) notFound();
    throw err;
  }
}
