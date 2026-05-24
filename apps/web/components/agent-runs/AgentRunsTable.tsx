'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { Eye } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { parseAsString, useQueryState } from 'nuqs';
import { useMemo } from 'react';

import { AgentRunDetailsDrawer } from '@/components/agent-runs/AgentRunDetailsDrawer';
import { LoadMoreFooter } from '@/components/common/load-more-footer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api, type ApiError } from '@/lib/api-client';
import { agentRunsKeys, type AgentRunListRow } from '@/lib/queries/agent-runs';
import {
  flattenCursorPages,
  getNextCursorParam,
  INITIAL_CURSOR,
  type CursorPage,
} from '@/lib/queries/cursor';

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
 *   - `id`              (written when a row is clicked → opens the drawer)
 *
 * Pagination is keyset / cursor-based (T36) via `useInfiniteQuery`:
 * the first request hits `/agent-runs` without `?cursor=`, the server
 * returns the bootstrap `cursor.next`, and each "Load more" click pulls
 * the next page using that opaque cursor. The legacy `?page=` URL state
 * was removed because cursors are opaque and not stable across mutations.
 */
export function AgentRunsTable() {
  const t = useTranslations('pages.agentRuns.table');

  const [from] = useQueryState('from', parseAsString);
  const [to] = useQueryState('to', parseAsString);
  const [status] = useQueryState('status', parseAsString.withDefault(''));
  const [action] = useQueryState('action', parseAsString.withDefault(''));
  const [agentName] = useQueryState('agentName', parseAsString.withDefault(''));
  const [selectedId, setSelectedId] = useQueryState('id', parseAsString);

  // Filter-only query — `cursor` is appended per request inside `queryFn`.
  // Excluding cursor from the cache key means a filter change resets the
  // walk while `fetchNextPage()` re-uses the same key.
  const filterQuery = useMemo(() => {
    const out: Record<string, string | number> = {
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
  }, [from, to, status, action, agentName]);

  const { data, error, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } =
    useInfiniteQuery<CursorPage<AgentRunListRow>, ApiError>({
      queryKey: agentRunsKeys.list(filterQuery),
      initialPageParam: INITIAL_CURSOR,
      queryFn: ({ pageParam }) =>
        api.get<AgentRunListRow[]>('/agent-runs', {
          query: {
            ...filterQuery,
            ...(typeof pageParam === 'string' && pageParam ? { cursor: pageParam } : {}),
          },
        }),
      getNextPageParam: getNextCursorParam,
    });

  const items = useMemo(() => flattenCursorPages<AgentRunListRow>(data), [data]);

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

      <LoadMoreFooter
        loadedCount={items.length}
        hasMore={hasNextPage}
        isFetchingMore={isFetchingNextPage}
        onLoadMore={() => {
          void fetchNextPage();
        }}
      />

      <AgentRunDetailsDrawer
        runId={selectedId}
        onClose={() => {
          void setSelectedId(null);
        }}
      />
    </div>
  );
}
