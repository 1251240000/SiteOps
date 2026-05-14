import { SeverityBadge } from './SeverityBadge';

export type FindingRow = {
  id: string;
  code: string;
  severity: string;
  title: string;
  message: string | null;
  url: string | null;
};

const ORDER: Record<string, number> = { critical: 0, error: 1, warning: 2, info: 3 };

export function FindingsTable({ items }: { items: FindingRow[] }) {
  const sorted = [...items].sort((a, b) => (ORDER[a.severity] ?? 9) - (ORDER[b.severity] ?? 9));
  if (sorted.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border bg-success/10 p-6 text-center text-sm text-success">
        No findings — this audit looks clean.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
      {sorted.map((f) => (
        <li key={f.id} className="space-y-1 p-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-semibold">{f.title}</span>
            <SeverityBadge severity={f.severity} />
          </div>
          <p className="font-mono text-xs text-muted-foreground">{f.code}</p>
          {f.message ? <p className="text-sm text-foreground">{f.message}</p> : null}
          {f.url ? (
            <a
              href={f.url}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-xs text-primary hover:underline"
            >
              {f.url}
            </a>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
