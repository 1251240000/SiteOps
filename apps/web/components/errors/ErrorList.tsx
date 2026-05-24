'use client';

import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { parseAsString, useQueryState } from 'nuqs';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { LoadMoreFooter } from '@/components/common/load-more-footer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api, type ApiError } from '@/lib/api-client';
import {
  flattenCursorPages,
  getNextCursorParam,
  INITIAL_CURSOR,
  type CursorPage,
} from '@/lib/queries/cursor';

import { ErrorDetailDrawer } from './ErrorDetailDrawer';

type ErrorRow = {
  id: string;
  siteId: string;
  source: string;
  level: string;
  message: string | null;
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  fingerprint: string;
};

const PAGE_SIZE = 50;

const queryKey = (q: Record<string, string>) => ['errors', q] as const;

/**
 * Errors list. Uses cursor-based pagination (T36) via `useInfiniteQuery` —
 * filters (`level`, `resolved`) live in URL state and form the cache key,
 * while the opaque cursor is appended per request inside `queryFn` so a
 * filter change resets the walk and a "Load more" click extends it.
 */
export function ErrorList() {
  const t = useTranslations('pages.errors.list');
  const tEnumLevel = useTranslations('enums.errorLevel');
  const [level, setLevel] = useQueryState('level', parseAsString.withDefault(''));
  const [resolved, setResolved] = useQueryState('resolved', parseAsString.withDefault('false'));
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Filter-only query — `cursor` is appended per request inside `queryFn`.
  const filterQuery = useMemo<Record<string, string>>(
    () => ({
      ...(level ? { level } : {}),
      resolved,
      limit: String(PAGE_SIZE),
    }),
    [level, resolved],
  );
  const qc = useQueryClient();
  const { data, isLoading, error, isFetchingNextPage, hasNextPage, fetchNextPage } =
    useInfiniteQuery<CursorPage<ErrorRow>, ApiError>({
      queryKey: queryKey(filterQuery),
      initialPageParam: INITIAL_CURSOR,
      queryFn: ({ pageParam }) =>
        api.get<ErrorRow[]>('/errors', {
          query: {
            ...filterQuery,
            ...(typeof pageParam === 'string' && pageParam ? { cursor: pageParam } : {}),
          },
        }),
      getNextPageParam: getNextCursorParam,
    });

  const resolveMut = useMutation<unknown, ApiError, { id: string; resolved: boolean }>({
    mutationFn: async ({ id, resolved: r }) => api.patch(`/errors/${id}`, { resolved: r }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['errors'] });
    },
    onError: (e) => toast.error(e.message),
  });

  const items = useMemo(() => flattenCursorPages<ErrorRow>(data), [data]);
  const selected = items.find((i) => i.id === selectedId) ?? null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-sm">
        <Button
          size="sm"
          variant={level === '' ? 'default' : 'outline'}
          onClick={() => void setLevel(null)}
        >
          {t('filterAll')}
        </Button>
        <Button
          size="sm"
          variant={level === 'error' ? 'default' : 'outline'}
          onClick={() => void setLevel('error')}
        >
          {t('filterErrors')}
        </Button>
        <Button
          size="sm"
          variant={level === 'warning' ? 'default' : 'outline'}
          onClick={() => void setLevel('warning')}
        >
          {t('filterWarnings')}
        </Button>
        <span className="ml-auto" />
        <Button
          size="sm"
          variant={resolved === 'true' ? 'default' : 'outline'}
          onClick={() => void setResolved(resolved === 'true' ? 'false' : 'true')}
        >
          {resolved === 'true' ? t('showingResolved') : t('hidingResolved')}
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left font-medium">{t('colMessage')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('colSource')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('colCount')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('colLastSeen')}</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-card">
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 5 }).map((__, j) => (
                    <td key={j} className="px-4 py-3">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  ))}
                </tr>
              ))
            ) : error ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-destructive">
                  {error.message}
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                  {t('empty')}
                </td>
              </tr>
            ) : (
              items.map((row) => (
                <tr key={row.id} className="hover:bg-muted/40">
                  <td className="px-4 py-3 align-middle">
                    <div className="space-y-1">
                      <span className="font-medium">{row.message ?? t('noMessage')}</span>
                      <p className="font-mono text-xs text-muted-foreground">
                        {row.fingerprint.slice(0, 12)}…
                      </p>
                    </div>
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <div className="flex flex-col gap-1">
                      <Badge variant="outline">{row.source}</Badge>
                      <Badge variant={row.level === 'error' ? 'destructive' : 'warning'}>
                        {row.level === 'error' || row.level === 'warning'
                          ? tEnumLevel(row.level)
                          : row.level}
                      </Badge>
                    </div>
                  </td>
                  <td className="px-4 py-3 align-middle font-semibold">{row.count}</td>
                  <td className="px-4 py-3 align-middle font-mono text-xs text-muted-foreground">
                    {new Date(row.lastSeenAt).toISOString()}
                  </td>
                  <td className="px-4 py-3 align-middle text-right">
                    <Button size="sm" variant="ghost" onClick={() => setSelectedId(row.id)}>
                      {t('details')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="ml-2"
                      onClick={() => resolveMut.mutate({ id: row.id, resolved: !row.resolvedAt })}
                    >
                      {row.resolvedAt ? t('reopen') : t('resolve')}
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

      <ErrorDetailDrawer error={selected} onClose={() => setSelectedId(null)} />
    </div>
  );
}
