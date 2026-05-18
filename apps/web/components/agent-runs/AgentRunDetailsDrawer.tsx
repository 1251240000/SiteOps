'use client';

import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api, type ApiError, type ApiSuccess } from '@/lib/api-client';
import { agentRunsKeys, type AgentRunDetail } from '@/lib/queries/agent-runs';
import { cn } from '@/lib/utils';

function JsonBlock({ value }: { value: Record<string, unknown> | null }) {
  if (!value) return <p className="text-xs italic text-muted-foreground">null</p>;
  return (
    <pre className="max-h-72 overflow-auto rounded-md border border-border bg-muted/40 p-3 text-xs leading-relaxed">
      <code>{JSON.stringify(value, null, 2)}</code>
    </pre>
  );
}

function msText(ms: number | null): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

/**
 * Right-side slide-in drawer that fetches `/api/v1/agent-runs/:id` and
 * renders the full input / output JSON. Mounted at the table level so the
 * URL `?id=…` state keeps the open row deep-linkable.
 *
 * Closes on Escape and on overlay click; calls `onClose` (which clears
 * `?id=` via nuqs).
 */
export function AgentRunDetailsDrawer({
  runId,
  onClose,
}: {
  runId: string | null;
  onClose: () => void;
}) {
  const t = useTranslations('pages.agentRuns.detail');
  const isOpen = !!runId;

  // Close on Escape — only when the drawer is open.
  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const { data, isLoading, error } = useQuery<ApiSuccess<AgentRunDetail>, ApiError>({
    queryKey: agentRunsKeys.detail(runId ?? ''),
    queryFn: () => api.get<AgentRunDetail>(`/agent-runs/${runId}`),
    enabled: isOpen,
  });
  const run = data?.data;

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="agent-run-drawer-title"
      className="fixed inset-0 z-50"
    >
      <button
        type="button"
        aria-label={t('close')}
        onClick={onClose}
        className="absolute inset-0 bg-foreground/40 backdrop-blur-sm"
      />
      <aside
        className={cn(
          'absolute inset-y-0 right-0 flex w-full max-w-xl flex-col border-l border-border bg-card shadow-xl',
        )}
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 id="agent-run-drawer-title" className="text-base font-semibold tracking-tight">
            {t('title')}
          </h2>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={onClose}
            aria-label={t('close')}
          >
            <X className="size-4" />
          </Button>
        </header>

        <div className="flex-1 space-y-4 overflow-auto px-4 py-4 text-sm">
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : error ? (
            <p className="text-destructive">{error.message || t('loadFailed')}</p>
          ) : run ? (
            <>
              <dl className="grid grid-cols-2 gap-2 text-xs">
                <div className="space-y-0.5">
                  <dt className="text-muted-foreground">{t('action')}</dt>
                  <dd className="font-mono">{run.action}</dd>
                </div>
                <div className="space-y-0.5">
                  <dt className="text-muted-foreground">{t('status')}</dt>
                  <dd>
                    <Badge
                      variant={run.status === 'success' ? 'secondary' : 'destructive'}
                      className="capitalize"
                    >
                      {run.status}
                    </Badge>
                  </dd>
                </div>
                <div className="space-y-0.5">
                  <dt className="text-muted-foreground">{t('agent')}</dt>
                  <dd>{run.agentName}</dd>
                </div>
                <div className="space-y-0.5">
                  <dt className="text-muted-foreground">{t('apiKey')}</dt>
                  <dd>{run.apiKey?.name ?? '—'}</dd>
                </div>
                <div className="space-y-0.5">
                  <dt className="text-muted-foreground">{t('duration')}</dt>
                  <dd className="tabular-nums">{msText(run.durationMs)}</dd>
                </div>
                <div className="space-y-0.5">
                  <dt className="text-muted-foreground">{t('when')}</dt>
                  <dd>
                    <time dateTime={run.createdAt}>{new Date(run.createdAt).toLocaleString()}</time>
                  </dd>
                </div>
                <div className="col-span-2 space-y-0.5">
                  <dt className="text-muted-foreground">{t('id')}</dt>
                  <dd className="font-mono text-xs">{run.id}</dd>
                </div>
              </dl>

              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('input')}
                </h3>
                <JsonBlock value={run.input} />
              </section>

              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('output')}
                </h3>
                <JsonBlock value={run.output} />
              </section>
            </>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
