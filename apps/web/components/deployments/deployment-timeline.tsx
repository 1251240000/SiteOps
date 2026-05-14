'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, GitBranch } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { DeploymentStatusBadge } from '@/components/deployments/deployment-status-badge';
import { formatDuration, formatRelativeTime, shortSha } from '@/components/deployments/duration';
import { api, type ApiError, type ApiSuccess } from '@/lib/api-client';
import { deploymentsKeys, type Deployment } from '@/lib/queries/deployments';

export function DeploymentTimeline({ siteId }: { siteId: string }) {
  const {
    data: envelope,
    error,
    isLoading,
  } = useQuery<ApiSuccess<Deployment[]>, ApiError>({
    queryKey: deploymentsKeys.forSite(siteId),
    queryFn: () => api.get<Deployment[]>(`/sites/${siteId}/deployments`),
  });
  const items = envelope?.data ?? [];

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-destructive">
          {error.message || 'Failed to load deployments'}
        </CardContent>
      </Card>
    );
  }
  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          No deployments recorded for this site yet. POST one to{' '}
          <code className="font-mono">/api/v1/sites/{siteId}/deployments</code>.
        </CardContent>
      </Card>
    );
  }

  return (
    <ol className="relative space-y-4 border-l border-border pl-6">
      {items.map((d) => (
        <li key={d.id} className="relative">
          <span
            aria-hidden
            className="absolute -left-[27px] top-1 grid size-4 place-items-center rounded-full border-2 border-background bg-muted"
          />
          <Card>
            <CardContent className="flex flex-col gap-2 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <DeploymentStatusBadge status={d.status} />
                <span className="font-mono text-sm">{shortSha(d.commitSha)}</span>
                {d.branch ? (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <GitBranch className="size-3" /> {d.branch}
                  </span>
                ) : null}
                {d.provider ? (
                  <span className="text-xs text-muted-foreground">via {d.provider}</span>
                ) : null}
                {d.triggeredBy ? (
                  <span className="text-xs text-muted-foreground">by {d.triggeredBy}</span>
                ) : null}
              </div>
              {d.commitMessage ? (
                <p className="line-clamp-2 text-sm text-foreground">{d.commitMessage}</p>
              ) : null}
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <time dateTime={d.startedAt ? new Date(d.startedAt).toISOString() : undefined}>
                  {formatRelativeTime(d.startedAt ?? d.createdAt)}
                </time>
                <span>·</span>
                <span className="tabular-nums">{formatDuration(d.durationMs)}</span>
                {d.buildLogUrl ? (
                  <>
                    <span>·</span>
                    <a
                      href={d.buildLogUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center text-primary hover:underline"
                    >
                      build log <ArrowUpRight className="size-3" />
                    </a>
                  </>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </li>
      ))}
    </ol>
  );
}
