'use client';

import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RotateCw, ShieldAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { parseAsString, useQueryState } from 'nuqs';
import { useMemo } from 'react';
import { toast } from 'sonner';

import { LoadMoreFooter } from '@/components/common/load-more-footer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { api, type ApiError, type ApiSuccess } from '@/lib/api-client';
import {
  flattenCursorPages,
  getNextCursorParam,
  INITIAL_CURSOR,
  type CursorPage,
} from '@/lib/queries/cursor';
import {
  webhooksKeys,
  type ReplayResponse,
  type WebhookEventRow,
  type WebhookProvider,
} from '@/lib/queries/webhooks';

const PROVIDERS = ['all', 'cloudflare', 'github'] as const;
const STATES = ['all', 'processed', 'failed', 'pending'] as const;
const SIG_OPTIONS = ['all', 'true', 'false'] as const;
const PAGE_SIZE = 50;

function relTime(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return `${Math.max(0, Math.floor(diff / 1000))}s`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

function rowState(r: WebhookEventRow): 'processed' | 'failed' | 'pending' | 'bad-sig' {
  if (!r.signatureOk) return 'bad-sig';
  if (r.error) return 'failed';
  if (r.processedAt) return 'processed';
  return 'pending';
}

const STATE_BADGE: Record<
  'processed' | 'failed' | 'pending' | 'bad-sig',
  'default' | 'destructive' | 'secondary' | 'outline'
> = {
  processed: 'default',
  failed: 'destructive',
  pending: 'outline',
  'bad-sig': 'destructive',
};

/**
 * Webhook deliveries table. Uses cursor-based pagination (T36) via
 * `useInfiniteQuery` — first request omits `?cursor=`, follow-ups pass
 * the opaque cursor returned by the server. Filters (`provider`, `state`,
 * `signatureOk`) live in URL state; `?page=` was removed because cursors
 * are opaque and not stable across mutations (e.g. replay).
 */
export function WebhooksTable() {
  const t = useTranslations('pages.webhooks');
  const qc = useQueryClient();

  const [provider, setProvider] = useQueryState('provider', parseAsString.withDefault('all'));
  const [state, setState] = useQueryState('state', parseAsString.withDefault('all'));
  const [signatureOk, setSignatureOk] = useQueryState(
    'signatureOk',
    parseAsString.withDefault('all'),
  );

  // Filter-only query — `cursor` is appended per request inside `queryFn`.
  // Excluding cursor from the cache key means a filter change resets the
  // walk while `fetchNextPage()` re-uses the same key.
  const filterQuery = useMemo(() => {
    const out: Record<string, string | number> = { limit: PAGE_SIZE };
    if (provider !== 'all') out['provider'] = provider;
    if (state !== 'all') out['state'] = state;
    if (signatureOk !== 'all') out['signatureOk'] = signatureOk;
    return out;
  }, [provider, state, signatureOk]);

  const { data, isLoading, error, isFetchingNextPage, hasNextPage, fetchNextPage } =
    useInfiniteQuery<CursorPage<WebhookEventRow>, ApiError>({
      queryKey: webhooksKeys.list(filterQuery),
      initialPageParam: INITIAL_CURSOR,
      queryFn: ({ pageParam }) =>
        api.get<WebhookEventRow[]>('/hooks', {
          query: {
            ...filterQuery,
            ...(typeof pageParam === 'string' && pageParam ? { cursor: pageParam } : {}),
          },
        }),
      getNextPageParam: getNextCursorParam,
    });

  const replay = useMutation<
    ApiSuccess<ReplayResponse>,
    ApiError,
    { id: string; provider: WebhookProvider }
  >({
    mutationFn: ({ id, provider }) => api.post<ReplayResponse>(`/hooks/${provider}/replay/${id}`),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: webhooksKeys.all });
      if (res.data.dispatchFailed) {
        toast.warning(t('table.replayFailedToast'));
      } else {
        toast.success(t('table.replayedToast'));
      }
    },
    onError: (err) => toast.error(err.message || t('table.replayFailed')),
  });

  const items = useMemo(() => flattenCursorPages<WebhookEventRow>(data), [data]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">{t('table.providerFilter')}</label>
          <Select value={provider} onValueChange={(v) => void setProvider(v)}>
            <SelectTrigger className="h-8 w-[140px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROVIDERS.map((p) => (
                <SelectItem key={p} value={p}>
                  {t(`table.providers.${p}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">{t('table.stateFilter')}</label>
          <Select value={state} onValueChange={(v) => void setState(v)}>
            <SelectTrigger className="h-8 w-[140px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATES.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`table.states.${s}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">{t('table.signatureFilter')}</label>
          <Select value={signatureOk} onValueChange={(v) => void setSignatureOk(v)}>
            <SelectTrigger className="h-8 w-[140px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SIG_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`table.signature.${s}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left font-medium">{t('table.colWhen')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('table.colProvider')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('table.colEvent')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('table.colDelivery')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('table.colState')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('table.colAttempts')}</th>
              <th className="px-4 py-3 text-right font-medium">
                <span className="sr-only">{t('table.replay')}</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-card">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
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
                  {error.message || t('table.loadFailed')}
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                  {t('table.empty')}
                </td>
              </tr>
            ) : (
              items.map((r) => {
                const s = rowState(r);
                const replayable = s === 'failed' || s === 'pending';
                return (
                  <tr key={r.id} className="hover:bg-muted/40">
                    <td className="px-4 py-3 align-middle text-muted-foreground">
                      <time dateTime={r.createdAt}>{relTime(r.createdAt)}</time>
                    </td>
                    <td className="px-4 py-3 align-middle capitalize">{r.provider}</td>
                    <td className="px-4 py-3 align-middle">
                      <code className="font-mono text-xs">{r.eventType}</code>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <code className="font-mono text-xs">
                        {r.deliveryId.length > 24 ? `${r.deliveryId.slice(0, 24)}…` : r.deliveryId}
                      </code>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <Badge variant={STATE_BADGE[s]} className="capitalize">
                        {s === 'bad-sig' ? (
                          <>
                            <ShieldAlert className="mr-1 size-3" />
                            {t('table.badSig')}
                          </>
                        ) : (
                          t(`table.states.${s}`)
                        )}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 align-middle tabular-nums">{r.attempts}</td>
                    <td className="px-4 py-3 text-right align-middle">
                      {replayable ? (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label={t('table.replay')}
                          disabled={replay.isPending}
                          onClick={() => replay.mutate({ id: r.id, provider: r.provider })}
                        >
                          <RotateCw className="size-4" />
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                );
              })
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
    </div>
  );
}
