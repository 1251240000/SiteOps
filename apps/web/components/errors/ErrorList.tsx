'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { parseAsString, useQueryState } from 'nuqs';
import { useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api, type ApiError, type ApiSuccess } from '@/lib/api-client';

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

const queryKey = (q: Record<string, string>) => ['errors', q] as const;

export function ErrorList() {
  const [level, setLevel] = useQueryState('level', parseAsString.withDefault(''));
  const [resolved, setResolved] = useQueryState('resolved', parseAsString.withDefault('false'));
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const queryParams = {
    ...(level ? { level } : {}),
    resolved,
    limit: '50',
  };
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery<ApiSuccess<ErrorRow[]>, ApiError>({
    queryKey: queryKey(queryParams),
    queryFn: () => api.get('/errors', { query: queryParams }),
  });

  const resolveMut = useMutation<unknown, ApiError, { id: string; resolved: boolean }>({
    mutationFn: async ({ id, resolved: r }) => api.patch(`/errors/${id}`, { resolved: r }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['errors'] });
    },
    onError: (e) => toast.error(e.message),
  });

  const items = data?.data ?? [];
  const selected = items.find((i) => i.id === selectedId) ?? null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-sm">
        <Button
          size="sm"
          variant={level === '' ? 'default' : 'outline'}
          onClick={() => void setLevel(null)}
        >
          All
        </Button>
        <Button
          size="sm"
          variant={level === 'error' ? 'default' : 'outline'}
          onClick={() => void setLevel('error')}
        >
          Errors
        </Button>
        <Button
          size="sm"
          variant={level === 'warning' ? 'default' : 'outline'}
          onClick={() => void setLevel('warning')}
        >
          Warnings
        </Button>
        <span className="ml-auto" />
        <Button
          size="sm"
          variant={resolved === 'true' ? 'default' : 'outline'}
          onClick={() => void setResolved(resolved === 'true' ? 'false' : 'true')}
        >
          {resolved === 'true' ? 'Showing resolved' : 'Hiding resolved'}
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Message</th>
              <th className="px-4 py-3 text-left font-medium">Source</th>
              <th className="px-4 py-3 text-left font-medium">Count</th>
              <th className="px-4 py-3 text-left font-medium">Last seen</th>
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
                  No matching errors.
                </td>
              </tr>
            ) : (
              items.map((row) => (
                <tr key={row.id} className="hover:bg-muted/40">
                  <td className="px-4 py-3 align-middle">
                    <div className="space-y-1">
                      <span className="font-medium">{row.message ?? '(no message)'}</span>
                      <p className="font-mono text-xs text-muted-foreground">
                        {row.fingerprint.slice(0, 12)}…
                      </p>
                    </div>
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <div className="flex flex-col gap-1">
                      <Badge variant="outline">{row.source}</Badge>
                      <Badge variant={row.level === 'error' ? 'destructive' : 'warning'}>
                        {row.level}
                      </Badge>
                    </div>
                  </td>
                  <td className="px-4 py-3 align-middle font-semibold">{row.count}</td>
                  <td className="px-4 py-3 align-middle font-mono text-xs text-muted-foreground">
                    {new Date(row.lastSeenAt).toISOString()}
                  </td>
                  <td className="px-4 py-3 align-middle text-right">
                    <Button size="sm" variant="ghost" onClick={() => setSelectedId(row.id)}>
                      Details
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="ml-2"
                      onClick={() => resolveMut.mutate({ id: row.id, resolved: !row.resolvedAt })}
                    >
                      {row.resolvedAt ? 'Reopen' : 'Resolve'}
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ErrorDetailDrawer error={selected} onClose={() => setSelectedId(null)} />
    </div>
  );
}
