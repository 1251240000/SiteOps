import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';

export type AuditRunRow = {
  id: string;
  auditType: string;
  status: string | null;
  startedAt: string | Date | null;
  finishedAt: string | Date | null;
  score: number | null;
};

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'destructive' | 'muted'> = {
  success: 'success',
  running: 'warning',
  failed: 'destructive',
};

const KNOWN_STATUS = ['success', 'running', 'failed', 'unknown'] as const;
type KnownStatus = (typeof KNOWN_STATUS)[number];

export function AuditList({ items, siteId }: { items: AuditRunRow[]; siteId: string }) {
  const t = useTranslations('pages.audits.list');
  const tStatus = useTranslations('enums.auditStatus');
  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border bg-muted/30 p-6 text-sm text-muted-foreground">
        {t('empty')}
      </p>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-3 text-left font-medium">{t('colType')}</th>
            <th className="px-4 py-3 text-left font-medium">{t('colStarted')}</th>
            <th className="px-4 py-3 text-left font-medium">{t('colDuration')}</th>
            <th className="px-4 py-3 text-left font-medium">{t('colStatus')}</th>
            <th className="px-4 py-3 text-left font-medium">{t('colScore')}</th>
            <th />
          </tr>
        </thead>
        <tbody className="divide-y divide-border bg-card">
          {items.map((r) => {
            const start = r.startedAt ? new Date(r.startedAt) : null;
            const end = r.finishedAt ? new Date(r.finishedAt) : null;
            const durMs = start && end ? end.getTime() - start.getTime() : null;
            return (
              <tr key={r.id} className="hover:bg-muted/40">
                <td className="px-4 py-3 align-middle">
                  <Badge variant="outline">{r.auditType}</Badge>
                </td>
                <td className="px-4 py-3 align-middle font-mono text-xs text-muted-foreground">
                  {start ? start.toISOString() : '—'}
                </td>
                <td className="px-4 py-3 align-middle text-muted-foreground">
                  {durMs === null
                    ? '—'
                    : t('durationFormat', { seconds: Math.round(durMs / 1000) })}
                </td>
                <td className="px-4 py-3 align-middle">
                  <Badge variant={(r.status ? STATUS_VARIANT[r.status] : undefined) ?? 'muted'}>
                    {(KNOWN_STATUS as readonly string[]).includes(r.status ?? 'unknown')
                      ? tStatus((r.status ?? 'unknown') as KnownStatus)
                      : (r.status ?? tStatus('unknown'))}
                  </Badge>
                </td>
                <td className="px-4 py-3 align-middle font-medium">
                  {r.score == null ? '—' : t('scoreFormat', { score: r.score })}
                </td>
                <td className="px-4 py-3 align-middle text-right">
                  <Link
                    href={`/sites/${siteId}/audits/${r.id}`}
                    className="text-sm text-primary hover:underline"
                  >
                    {t('details')}
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
