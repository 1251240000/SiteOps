'use client';

import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Eye } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { parseAsInteger, parseAsString, useQueryState } from 'nuqs';
import { useMemo } from 'react';

import { AgentRunDetailsDrawer } from '@/components/agent-runs/AgentRunDetailsDrawer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api, type ApiError, type ApiSuccess } from '@/lib/api-client';
import {
  agentRunsKeys,
  type AgentRunListRow,
  type AgentRunsListMeta,
} from '@/lib/queries/agent-runs';

const PAGE_SIZE = 50;

function msText(ms: number | null): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function relativeTime(iso: string): string {
  const now = Date.now();
  const t = new Date(iso).getTime();
  const diff = Math.max(0, now - t);
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

/**
 * Main table for the agent-runs dashboard. URL state owns:
 *   - `from` / `to`     (read; written by `<DateRangePicker />`)
 *   - `status`          (read; written by `<AgentRunsFilters />`)
 *   - `action`          (read; written by `<AgentRunsFilters />`)
 *   - `agentName`       (read; written by `<AgentRunsFilters />`)
 *   - `page`            (read + written here)
 *   - `id`              (written when a row is clicked → opens the drawer)
 */
export function AgentRunsTable() {
  const t = useTranslations('pages.agentRuns.table');
  const tCommon = useTranslations('common');

  const [from] = useQueryState('from', parseAsString);
  const [to] = useQueryState('to', parseAsString);
  const [status] = useQueryState('status', parseAsString.withDefault(''));
  const [action] = useQueryState('action', parseAsString.withDefault(''));
  const [agentName] = useQueryState('agentName', parseAsString.withDefault(''));
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
  const [selectedId, setSelectedId] = useQueryState('id', parseAsString);

  const query = useMemo(() => {
    const out: Record<string, string | number> = {
      page,
      limit: PAGE_SIZE,
      sort: '-created_at',
    };
    if (from) out['from'] = new Date(`${from}T00:00:00Z`).toISOString();
    if (to) {
      // `to` is inclusive — push it to the end of day so rows logged
      // throughout the chosen end date are included.
      out['to'] = new Date(`${to}T23:59:59.999Z`).toISOString();
    }
    if (status) out['status'] = status;
    if (action) out['action'] = action;
    if (agentName) out['agentName'] = agentName;
    return out;
  }, [from, to, status, action, agentName, page]);

  const { data, error, isLoading } = useQuery<ApiSuccess<AgentRunListRow[]>, ApiError>({
    queryKey: agentRunsKeys.list(query),
    queryFn: () => api.get<AgentRunListRow[]>('/agent-runs', { query }),
  });

  const items = data?.data ?? [];
  const meta = data?.meta as AgentRunsListMeta | undefined;

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-3 text-left font-medium">
                {t('colWhen')}
              </th>
              <th scope="col" className="px-4 py-3 text-left font-medium">
                {t('colAgent')}
              </th>
              <th scope="col" className="px-4 py-3 text-left font-medium">
                {t('colAction')}
              </th>
              <th scope="col" className="px-4 py-3 text-left font-medium">
                {t('colStatus')}
              </th>
              <th scope="col" className="px-4 py-3 text-left font-medium">
                {t('colDuration')}
              </th>
              <th scope="col" className="px-4 py-3 text-left font-medium">
                {t('colApiKey')}
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                <span className="sr-only">{t('viewAction')}</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-card">
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={`sk-${i}`}>
                  {Array.from({ length: 7 }).map((__, j) => (
                    <td key={j} className="px-4 py-3">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  ))}
                </tr>
              ))
            ) : error ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-destructive">
                  {error.message || t('loadFailed')}
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                  {t('empty')}
                </td>
              </tr>
            ) : (
              items.map((r) => (
                <tr key={r.id} className="hover:bg-muted/40">
                  <td className="px-4 py-3 align-middle text-muted-foreground">
                    <time dateTime={r.createdAt}>{relativeTime(r.createdAt)}</time>
                  </td>
                  <td className="px-4 py-3 align-middle">{r.agentName}</td>
                  <td className="px-4 py-3 align-middle">
                    <code className="font-mono text-xs">{r.action}</code>
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <Badge
                      variant={r.status === 'success' ? 'secondary' : 'destructive'}
                      className="capitalize"
                    >
                      {r.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 align-middle tabular-nums">{msText(r.durationMs)}</td>
                  <td className="px-4 py-3 align-middle text-muted-foreground">
                    {r.apiKey?.name ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-right align-middle">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => {
                        void setSelectedId(r.id);
                      }}
                      aria-label={t('viewAction')}
                    >
                      <Eye className="size-4" />
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span>
          {meta
            ? tCommon('pagination.showing', {
                from: items.length ? (meta.page - 1) * meta.limit + 1 : 0,
                to: (meta.page - 1) * meta.limit + items.length,
                total: meta.total,
              })
            : '\u00A0'}
        </span>
        <div className="flex items-center gap-2">
          <span>
            {tCommon.rich('pagination.page', {
              strong: (chunks) => <strong>{chunks}</strong>,
              page: meta?.page ?? page,
              total: meta?.totalPages ?? 1,
            })}
          </span>
          <Button
            size="icon"
            variant="outline"
            disabled={!meta || meta.page <= 1}
            onClick={() => setPage(Math.max(1, (meta?.page ?? page) - 1))}
            aria-label={tCommon('pagination.previous')}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="outline"
            disabled={!meta || meta.page >= (meta?.totalPages ?? 1)}
            onClick={() => setPage((meta?.page ?? page) + 1)}
            aria-label={tCommon('pagination.next')}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <AgentRunDetailsDrawer
        runId={selectedId}
        onClose={() => {
          void setSelectedId(null);
        }}
      />
    </div>
  );
}
