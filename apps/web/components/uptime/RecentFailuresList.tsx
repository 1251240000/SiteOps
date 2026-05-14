export type UptimeFailure = {
  id: string | number;
  checkedAt: string | Date;
  statusCode: number | null;
  responseTimeMs: number | null;
  error: string | null;
  url: string;
};

export function RecentFailuresList({ items }: { items: UptimeFailure[] }) {
  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border bg-muted/30 p-6 text-sm text-muted-foreground">
        No failures in the selected window.
      </p>
    );
  }
  return (
    <ol className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
      {items.map((f) => (
        <li key={String(f.id)} className="flex flex-col gap-1 p-4 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <time className="font-mono text-xs text-muted-foreground">
              {new Date(f.checkedAt).toISOString()}
            </time>
            <span className="text-destructive font-medium">
              {f.statusCode != null ? `HTTP ${f.statusCode}` : 'network error'}
            </span>
          </div>
          <p className="text-foreground">{f.error ?? 'No error message recorded.'}</p>
          <p className="font-mono text-xs text-muted-foreground">
            {f.url}
            {f.responseTimeMs != null ? <span> · {f.responseTimeMs} ms</span> : null}
          </p>
        </li>
      ))}
    </ol>
  );
}
