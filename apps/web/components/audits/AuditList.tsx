import Link from 'next/link';

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

export function AuditList({ items, siteId }: { items: AuditRunRow[]; siteId: string }) {
  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border bg-muted/30 p-6 text-sm text-muted-foreground">
        No audit runs yet. Trigger one above.
      </p>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-3 text-left font-medium">Type</th>
            <th className="px-4 py-3 text-left font-medium">Started</th>
            <th className="px-4 py-3 text-left font-medium">Duration</th>
            <th className="px-4 py-3 text-left font-medium">Status</th>
            <th className="px-4 py-3 text-left font-medium">Score</th>
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
                  {durMs === null ? '—' : `${Math.round(durMs / 1000)} s`}
                </td>
                <td className="px-4 py-3 align-middle">
                  <Badge variant={(r.status ? STATUS_VARIANT[r.status] : undefined) ?? 'muted'}>
                    {r.status ?? 'unknown'}
                  </Badge>
                </td>
                <td className="px-4 py-3 align-middle font-medium">
                  {r.score == null ? '—' : `${r.score}/100`}
                </td>
                <td className="px-4 py-3 align-middle text-right">
                  <Link
                    href={`/sites/${siteId}/audits/${r.id}`}
                    className="text-sm text-primary hover:underline"
                  >
                    Details →
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
