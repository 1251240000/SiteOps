'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { parseAsInteger, parseAsString, useQueryState } from 'nuqs';
import { useMemo } from 'react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { DeploymentStatusBadge } from '@/components/deployments/deployment-status-badge';
import { formatDuration, formatRelativeTime, shortSha } from '@/components/deployments/duration';
import { api, type ApiError, type ApiSuccess } from '@/lib/api-client';
import {
  deploymentsKeys,
  type Deployment,
  type DeploymentsListMeta,
} from '@/lib/queries/deployments';

const PAGE_SIZE = 20;

export function DeploymentList() {
  const [siteId] = useQueryState('siteId', parseAsString.withDefault(''));
  const [status] = useQueryState('status', parseAsString.withDefault(''));
  const [provider] = useQueryState('provider', parseAsString.withDefault(''));
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));

  const query = useMemo(() => {
    const out: Record<string, string | number | boolean> = {
      page,
      limit: PAGE_SIZE,
      sort: '-started_at',
    };
    if (siteId) out['siteId'] = siteId;
    if (status) out['status'] = status;
    if (provider) out['provider'] = provider;
    return out;
  }, [siteId, status, provider, page]);

  const {
    data: envelope,
    error,
    isLoading,
  } = useQuery<ApiSuccess<Deployment[]>, ApiError>({
    queryKey: deploymentsKeys.list(query),
    queryFn: () => api.get<Deployment[]>('/deployments', { query }),
  });
  const items = envelope?.data ?? [];
  const meta = envelope?.meta as DeploymentsListMeta | undefined;

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-3 text-left font-medium">
                Site
              </th>
              <th scope="col" className="px-4 py-3 text-left font-medium">
                Status
              </th>
              <th scope="col" className="px-4 py-3 text-left font-medium">
                Commit
              </th>
              <th scope="col" className="px-4 py-3 text-left font-medium">
                Provider
              </th>
              <th scope="col" className="px-4 py-3 text-left font-medium">
                Duration
              </th>
              <th scope="col" className="px-4 py-3 text-left font-medium">
                When
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-card">
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={`sk-${i}`}>
                  {Array.from({ length: 6 }).map((__, j) => (
                    <td key={j} className="px-4 py-3">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  ))}
                </tr>
              ))
            ) : error ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-destructive">
                  {error.message || 'Failed to load deployments'}
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                  No deployments yet. POST one to{' '}
                  <code className="font-mono">/api/v1/deployments</code>.
                </td>
              </tr>
            ) : (
              items.map((d) => (
                <tr key={d.id} className="hover:bg-muted/40">
                  <td className="px-4 py-3 align-middle">
                    <Link
                      href={`/sites/${d.siteId}/deployments`}
                      className="font-mono text-xs text-muted-foreground hover:text-foreground"
                    >
                      {d.siteId.slice(0, 8)}…
                    </Link>
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <DeploymentStatusBadge status={d.status} />
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <div className="flex flex-col">
                      <span className="font-mono text-xs">{shortSha(d.commitSha)}</span>
                      {d.branch ? (
                        <span className="text-xs text-muted-foreground">{d.branch}</span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3 align-middle text-muted-foreground">
                    {d.provider ?? '—'}
                  </td>
                  <td className="px-4 py-3 align-middle tabular-nums">
                    {formatDuration(d.durationMs)}
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <div className="flex items-center gap-2">
                      <time
                        dateTime={d.startedAt ? new Date(d.startedAt).toISOString() : undefined}
                        className="text-muted-foreground"
                      >
                        {formatRelativeTime(d.startedAt ?? d.createdAt)}
                      </time>
                      {d.buildLogUrl ? (
                        <a
                          href={d.buildLogUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center text-xs text-primary hover:underline"
                        >
                          log <ArrowUpRight className="size-3" />
                        </a>
                      ) : null}
                    </div>
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
            ? `Showing ${items.length ? (meta.page - 1) * meta.limit + 1 : 0}–${(meta.page - 1) * meta.limit + items.length} of ${meta.total}`
            : '\u00A0'}
        </span>
        <div className="flex items-center gap-2">
          <span>
            Page <strong>{meta?.page ?? page}</strong> of <strong>{meta?.totalPages ?? 1}</strong>
          </span>
          <Button
            size="icon"
            variant="outline"
            disabled={!meta || meta.page <= 1}
            onClick={() => setPage(Math.max(1, (meta?.page ?? page) - 1))}
            aria-label="Previous page"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="outline"
            disabled={!meta || meta.page >= (meta?.totalPages ?? 1)}
            onClick={() => setPage((meta?.page ?? page) + 1)}
            aria-label="Next page"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
