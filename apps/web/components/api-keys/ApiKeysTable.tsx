'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { parseAsStringLiteral, useQueryState } from 'nuqs';
import { useState } from 'react';
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
import { apiKeysKeys, type ApiKeyRow, type ApiKeyState } from '@/lib/queries/api-keys';

const STATE_VALUES = ['all', 'active', 'revoked', 'expired'] as const;
type StateFilter = (typeof STATE_VALUES)[number];

function relTime(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return `${Math.max(0, Math.floor(diff / 1000))}s`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

function rowState(row: ApiKeyRow): 'active' | 'revoked' | 'expired' {
  if (row.revokedAt) return 'revoked';
  if (row.expiresAt && new Date(row.expiresAt).getTime() <= Date.now()) return 'expired';
  return 'active';
}

const STATE_BADGE: Record<
  'active' | 'revoked' | 'expired',
  'default' | 'destructive' | 'secondary'
> = {
  active: 'default',
  revoked: 'destructive',
  expired: 'secondary',
};

export function ApiKeysTable() {
  const t = useTranslations('pages.apiKeys');
  const qc = useQueryClient();
  const [state, setState] = useQueryState(
    'state',
    parseAsStringLiteral(STATE_VALUES).withDefault('all'),
  );
  const [confirmRow, setConfirmRow] = useState<ApiKeyRow | null>(null);
  const [editRow, setEditRow] = useState<ApiKeyRow | null>(null);
  const [editValue, setEditValue] = useState('');

  const filter: ApiKeyState | undefined = state === 'all' ? undefined : state;

  const { data, isLoading, error } = useQuery<ApiSuccess<ApiKeyRow[]>, ApiError>({
    queryKey: apiKeysKeys.list(state as StateFilter),
    queryFn: () =>
      api.get<ApiKeyRow[]>('/settings/api-keys', {
        query: filter ? { state: filter } : {},
      }),
  });

  const revoke = useMutation<ApiSuccess<ApiKeyRow>, ApiError, string>({
    mutationFn: (id) => api.delete<ApiKeyRow>(`/settings/api-keys/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: apiKeysKeys.lists() });
      toast.success(t('table.revokedToast'));
    },
    onError: (err) => toast.error(err.message || t('table.revokeFailed')),
    onSettled: () => setConfirmRow(null),
  });

  const updateRate = useMutation<
    ApiSuccess<ApiKeyRow>,
    ApiError,
    { id: string; rateLimitPerMin: number | null }
  >({
    mutationFn: ({ id, rateLimitPerMin }) =>
      api.patch<ApiKeyRow>(`/settings/api-keys/${id}`, { rateLimitPerMin }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: apiKeysKeys.lists() });
      toast.success(t('table.rateLimitUpdatedToast'));
    },
    onError: (err) => toast.error(err.message || t('table.rateLimitUpdateFailed')),
    onSettled: () => setEditRow(null),
  });

  function openEdit(row: ApiKeyRow): void {
    setEditRow(row);
    setEditValue(row.rateLimitPerMin === null ? '' : String(row.rateLimitPerMin));
  }

  function submitEdit(): void {
    if (!editRow) return;
    const trimmed = editValue.trim();
    if (trimmed === '') {
      // Empty input clears the override → fall back to env default.
      updateRate.mutate({ id: editRow.id, rateLimitPerMin: null });
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
      toast.error(t('table.rateLimitInvalid'));
      return;
    }
    updateRate.mutate({ id: editRow.id, rateLimitPerMin: n });
  }

  const items = data?.data ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Select value={state} onValueChange={(v) => void setState(v as StateFilter)}>
          <SelectTrigger className="h-8 w-[160px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATE_VALUES.map((v) => (
              <SelectItem key={v} value={v}>
                {t(`table.state.${v}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left font-medium">{t('table.colName')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('table.colPrefix')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('table.colScopes')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('table.colRateLimit')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('table.colState')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('table.colLastUsed')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('table.colCreated')}</th>
              <th className="px-4 py-3 text-right font-medium">
                <span className="sr-only">{t('table.actionsAriaLabel')}</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-card">
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 8 }).map((__, j) => (
                    <td key={j} className="px-4 py-3">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  ))}
                </tr>
              ))
            ) : error ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-destructive">
                  {error.message || t('table.loadFailed')}
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                  {t('table.empty')}
                </td>
              </tr>
            ) : (
              items.map((r) => {
                const s = rowState(r);
                return (
                  <tr key={r.id} className="hover:bg-muted/40">
                    <td className="px-4 py-3 align-middle font-medium">{r.name}</td>
                    <td className="px-4 py-3 align-middle">
                      <code className="font-mono text-xs">{r.keyPrefix}…</code>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <div className="flex flex-wrap gap-1">
                        {r.scopes.map((s2) => (
                          <Badge key={s2} variant="secondary" className="font-mono text-[11px]">
                            {s2}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-middle text-muted-foreground">
                      {r.rateLimitPerMin === null
                        ? t('table.rateLimitDefault')
                        : t('table.rateLimitValue', { value: r.rateLimitPerMin })}
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <Badge variant={STATE_BADGE[s]} className="capitalize">
                        {t(`table.state.${s}`)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 align-middle text-muted-foreground">
                      {relTime(r.lastUsedAt)}
                    </td>
                    <td className="px-4 py-3 align-middle text-muted-foreground">
                      {relTime(r.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-right align-middle">
                      {s === 'active' ? (
                        <div className="inline-flex items-center gap-1">
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            aria-label={t('table.editRateLimit')}
                            onClick={() => openEdit(r)}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            aria-label={t('table.revoke')}
                            onClick={() => setConfirmRow(r)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <AlertDialog
        open={confirmRow !== null}
        onOpenChange={(o) => {
          if (!o) setConfirmRow(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('table.confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('table.confirmDescription', { name: confirmRow?.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('table.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmRow) revoke.mutate(confirmRow.id);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('table.confirmRevoke')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={editRow !== null}
        onOpenChange={(o) => {
          if (!o) setEditRow(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('table.editRateLimitTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('table.editRateLimitDescription', { name: editRow?.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="api-key-rate-limit-edit">{t('table.editRateLimitLabel')}</Label>
            <Input
              id="api-key-rate-limit-edit"
              type="number"
              inputMode="numeric"
              min={1}
              max={100000}
              step={1}
              value={editValue}
              placeholder={t('table.editRateLimitPlaceholder')}
              onChange={(e) => setEditValue(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t('table.editRateLimitHint')}</p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('table.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={submitEdit} disabled={updateRate.isPending}>
              {t('table.editRateLimitSubmit')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
