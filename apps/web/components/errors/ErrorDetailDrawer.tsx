'use client';

import { X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api, type ApiError } from '@/lib/api-client';

type ErrorDetail = {
  id: string;
  siteId: string;
  source: string;
  level: string;
  message: string | null;
  stack: string | null;
  meta: Record<string, unknown> | null;
  fingerprint: string;
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
};

export function ErrorDetailDrawer({
  error,
  onClose,
}: {
  error: { id: string } | null;
  onClose: () => void;
}) {
  const [full, setFull] = useState<ErrorDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchErr, setFetchErr] = useState<string | null>(null);

  useEffect(() => {
    if (!error) {
      setFull(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setFetchErr(null);
    api
      .get<ErrorDetail>(`/errors/${error.id}`)
      .then((res) => {
        if (!cancelled) setFull(res.data);
      })
      .catch((e: ApiError) => {
        if (!cancelled) setFetchErr(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [error]);

  if (!error) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-xl flex-col border-l border-border bg-card shadow-xl"
    >
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Error detail</h2>
        <Button size="icon" variant="ghost" onClick={onClose} aria-label="Close">
          <X />
        </Button>
      </header>
      <div className="flex-1 space-y-3 overflow-y-auto p-4 text-sm">
        {loading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : fetchErr ? (
          <p className="text-destructive">{fetchErr}</p>
        ) : full ? (
          <>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{full.source}</Badge>
              <Badge variant={full.level === 'error' ? 'destructive' : 'warning'}>
                {full.level}
              </Badge>
              {full.resolvedAt ? <Badge variant="success">resolved</Badge> : null}
              <Badge variant="muted">×{full.count}</Badge>
            </div>
            <h3 className="text-base font-semibold">{full.message ?? '(no message)'}</h3>
            <div className="space-y-1">
              <span className="text-xs uppercase text-muted-foreground">Fingerprint</span>
              <code className="block break-all rounded bg-muted p-2 font-mono text-xs">
                {full.fingerprint}
              </code>
            </div>
            <div className="space-y-1">
              <span className="text-xs uppercase text-muted-foreground">Stack trace</span>
              <pre className="max-h-72 overflow-auto rounded bg-muted p-2 font-mono text-xs">
                {full.stack ?? '(no stack)'}
              </pre>
            </div>
            <div className="space-y-1">
              <span className="text-xs uppercase text-muted-foreground">Meta</span>
              <pre className="max-h-48 overflow-auto rounded bg-muted p-2 font-mono text-xs">
                {full.meta ? JSON.stringify(full.meta, null, 2) : '(none)'}
              </pre>
            </div>
            <dl className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <dt className="text-muted-foreground">First seen</dt>
                <dd className="font-mono">{new Date(full.firstSeenAt).toISOString()}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Last seen</dt>
                <dd className="font-mono">{new Date(full.lastSeenAt).toISOString()}</dd>
              </div>
            </dl>
          </>
        ) : null}
      </div>
    </div>
  );
}
