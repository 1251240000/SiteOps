'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { parseAsInteger, parseAsString, useQueryState } from 'nuqs';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { api, type ApiError, type ApiSuccess } from '@/lib/api-client';
import { tasksKeys, type TaskRow, type TaskStatus } from '@/lib/queries/tasks';

const STATUS_VALUES = [
  '',
  'queued',
  'claimed',
  'succeeded',
  'failed',
  'cancelled',
  'expired',
] as const;
const STATUS_BADGE: Record<TaskStatus, 'default' | 'destructive' | 'secondary' | 'outline'> = {
  queued: 'outline',
  claimed: 'secondary',
  succeeded: 'default',
  failed: 'destructive',
  cancelled: 'outline',
  expired: 'destructive',
};
const PAGE_SIZE = 50;

function relTime(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) {
    const future = -diff;
    if (future < 60_000) return `+${Math.floor(future / 1000)}s`;
    return `+${Math.floor(future / 60_000)}m`;
  }
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

export function TasksTable() {
  const t = useTranslations('pages.tasks.table');
  const tCommon = useTranslations('common');
  const qc = useQueryClient();

  const [status, setStatus] = useQueryState('status', parseAsString.withDefault(''));
  const [kind, setKind] = useQueryState('kind', parseAsString.withDefault(''));
  const [siteId, setSiteId] = useQueryState('siteId', parseAsString.withDefault(''));
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
  const [confirm, setConfirm] = useState<TaskRow | null>(null);

  const query = useMemo(() => {
    const out: Record<string, string | number> = {
      page,
      limit: PAGE_SIZE,
      sort: '-created_at',
    };
    if (status) out['status'] = status;
    if (kind) out['kind'] = kind;
    if (siteId) out['siteId'] = siteId;
    return out;
  }, [status, kind, siteId, page]);

  const { data, isLoading, error } = useQuery<ApiSuccess<TaskRow[]>, ApiError>({
    queryKey: tasksKeys.list(query),
    queryFn: () => api.get<TaskRow[]>('/tasks', { query }),
  });

  const cancel = useMutation<ApiSuccess<TaskRow>, ApiError, string>({
    mutationFn: (id) => api.patch<TaskRow>(`/tasks/${id}`, { status: 'cancelled' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: tasksKeys.all });
      toast.success(t('cancelledToast'));
    },
    onError: (err) => toast.error(err.message || t('cancelFailed')),
    onSettled: () => setConfirm(null),
  });

  const items = data?.data ?? [];
  const meta = data?.meta as
    | { page: number; limit: number; total: number; totalPages: number }
    | undefined;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 md:flex-row md:items-end">
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">{t('statusFilter')}</Label>
          <Select
            value={status === '' ? 'any' : status}
            onValueChange={(v) => void setStatus(v === 'any' ? null : v)}
          >
            <SelectTrigger className="h-8 w-[160px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">{t('anyStatus')}</SelectItem>
              {STATUS_VALUES.filter((s): s is TaskStatus => s !== '').map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <Label htmlFor="task-kind" className="text-xs text-muted-foreground">
            {t('kindFilter')}
          </Label>
          <Input
            id="task-kind"
            value={kind}
            placeholder={t('kindPlaceholder')}
            onChange={(e) => void setKind(e.target.value || null)}
            className="h-8 text-xs"
          />
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <Label htmlFor="task-site" className="text-xs text-muted-foreground">
            {t('siteFilter')}
          </Label>
          <Input
            id="task-site"
            value={siteId}
            placeholder={t('sitePlaceholder')}
            onChange={(e) => void setSiteId(e.target.value || null)}
            className="h-8 text-xs"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left font-medium">{t('colKind')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('colStatus')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('colAttempts')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('colPriority')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('colAvailableAt')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('colCreated')}</th>
              <th className="px-4 py-3 text-right font-medium">
                <span className="sr-only">{t('actionCancel')}</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-card">
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
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
              items.map((r) => {
                const cancelable = r.status === 'queued' || r.status === 'claimed';
                return (
                  <tr key={r.id} className="hover:bg-muted/40">
                    <td className="px-4 py-3 align-middle">
                      <code className="font-mono text-xs">{r.kind}</code>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <Badge variant={STATUS_BADGE[r.status]} className="capitalize">
                        {r.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 align-middle tabular-nums">
                      {r.attempts}/{r.maxAttempts}
                    </td>
                    <td className="px-4 py-3 align-middle tabular-nums">{r.priority}</td>
                    <td className="px-4 py-3 align-middle text-muted-foreground">
                      {relTime(r.availableAt)}
                    </td>
                    <td className="px-4 py-3 align-middle text-muted-foreground">
                      {relTime(r.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-right align-middle">
                      {cancelable ? (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label={t('actionCancel')}
                          onClick={() => setConfirm(r)}
                        >
                          <Ban className="size-4" />
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

      <AlertDialog
        open={confirm !== null}
        onOpenChange={(o) => {
          if (!o) setConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('cancelConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('cancelConfirmDescription', { kind: confirm?.kind ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancelDialog')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirm) cancel.mutate(confirm.id);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('confirmCancel')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
