'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api, type ApiError, type ApiSuccess } from '@/lib/api-client';

type AlertRow = {
  id: string;
  ruleId: string;
  siteId: string | null;
  status: 'firing' | 'resolved';
  value: string | null;
  message: string | null;
  firedAt: string;
  resolvedAt: string | null;
  notifiedChannels: Array<{
    channel_id: string;
    sent_at: string;
    ok: boolean;
    error?: string;
  }> | null;
};

export function AlertList() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery<ApiSuccess<AlertRow[]>, ApiError>({
    queryKey: ['alerts', 'list'],
    queryFn: () => api.get('/alerts', { query: { limit: 100 } }),
  });

  const ackMut = useMutation<unknown, ApiError, string>({
    mutationFn: (id) => api.post(`/alerts/${id}/ack`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['alerts'] });
      toast.success('Alert resolved');
    },
    onError: (e) => toast.error(e.message),
  });

  const items = data?.data ?? [];

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <p className="rounded-lg border border-destructive p-4 text-sm text-destructive">
        {error.message}
      </p>
    );
  }
  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border bg-success/10 p-6 text-center text-sm text-success">
        No alerts. The monitoring stack is happy.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
      {items.map((a) => (
        <li
          key={a.id}
          className="flex flex-col gap-2 p-4 md:flex-row md:items-center md:justify-between"
        >
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={a.status === 'firing' ? 'destructive' : 'success'}>{a.status}</Badge>
              <span className="font-medium">{a.message ?? '(no message)'}</span>
            </div>
            <p className="font-mono text-xs text-muted-foreground">
              fired {new Date(a.firedAt).toISOString()}
              {a.resolvedAt ? ` · resolved ${new Date(a.resolvedAt).toISOString()}` : ''}
            </p>
            {a.notifiedChannels && a.notifiedChannels.length > 0 ? (
              <p className="font-mono text-xs text-muted-foreground">
                Last delivery:{' '}
                {a.notifiedChannels.slice(-1).map((d) => (
                  <span key={d.channel_id}>
                    {d.ok ? '✓' : '✗'} {d.channel_id.slice(0, 8)}
                    {d.error ? ` (${d.error})` : ''}
                  </span>
                ))}
              </p>
            ) : null}
          </div>
          <div>
            {a.status === 'firing' ? (
              <Button size="sm" variant="outline" onClick={() => ackMut.mutate(a.id)}>
                Mark resolved
              </Button>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
