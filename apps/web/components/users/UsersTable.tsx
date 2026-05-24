'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, ShieldOff, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
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
import { usersKeys, type UserRole, type UserRow } from '@/lib/queries/users';

const ROLES: UserRole[] = ['admin', 'operator', 'viewer'];

const ROLE_BADGE: Record<UserRole, 'default' | 'secondary' | 'outline'> = {
  admin: 'default',
  operator: 'secondary',
  viewer: 'outline',
};

function relTime(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return `${Math.max(0, Math.floor(diff / 1000))}s`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

export interface UsersTableProps {
  /**
   * The signed-in user's id, resolved server-side in the page (no
   * `<SessionProvider />` is wired into the dashboard tree). Used to disable
   * self-mutation actions on the row that represents the caller.
   */
  currentUserId: string | null;
}

export function UsersTable({ currentUserId }: UsersTableProps) {
  const t = useTranslations('pages.users');
  const qc = useQueryClient();

  const [editRow, setEditRow] = useState<UserRow | null>(null);
  const [editRole, setEditRole] = useState<UserRole>('viewer');
  const [suspendRow, setSuspendRow] = useState<UserRow | null>(null);

  const { data, isLoading, error } = useQuery<ApiSuccess<UserRow[]>, ApiError>({
    queryKey: usersKeys.list({}),
    queryFn: () => api.get<UserRow[]>('/users'),
  });

  const update = useMutation<
    ApiSuccess<UserRow>,
    ApiError,
    { id: string; role?: UserRole; status?: 'active' | 'suspended' }
  >({
    mutationFn: ({ id, ...rest }) => api.patch<UserRow>(`/users/${id}`, rest),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: usersKeys.lists() });
      toast.success(t('table.updatedToast'));
    },
    onError: (err) => toast.error(err.message || t('table.updateFailed')),
    onSettled: () => {
      setEditRow(null);
      setSuspendRow(null);
    },
  });

  function openEdit(row: UserRow): void {
    setEditRow(row);
    setEditRole(row.role);
  }

  function submitEdit(): void {
    if (!editRow) return;
    if (editRole === editRow.role) {
      setEditRow(null);
      return;
    }
    update.mutate({ id: editRow.id, role: editRole });
  }

  const items = data?.data ?? [];

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left font-medium">{t('table.colEmail')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('table.colName')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('table.colRole')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('table.colStatus')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('table.colLastLogin')}</th>
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
              items.map((u) => {
                const isSelf = u.id === currentUserId;
                return (
                  <tr key={u.id} className="hover:bg-muted/40">
                    <td className="px-4 py-3 align-middle font-medium">{u.email}</td>
                    <td className="px-4 py-3 align-middle text-muted-foreground">
                      {u.name ?? '—'}
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <Badge variant={ROLE_BADGE[u.role]} className="capitalize">
                        {t(`roles.${u.role}`)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <Badge variant={u.status === 'active' ? 'default' : 'destructive'}>
                        {t(`statuses.${u.status}`)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 align-middle text-muted-foreground">
                      {relTime(u.lastLoginAt)}
                    </td>
                    <td className="px-4 py-3 align-middle text-muted-foreground">
                      {relTime(u.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-right align-middle">
                      <div className="inline-flex items-center gap-1">
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label={t('table.editRole')}
                          disabled={isSelf}
                          onClick={() => openEdit(u)}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label={
                            u.status === 'active' ? t('table.suspend') : t('table.reactivate')
                          }
                          disabled={isSelf}
                          onClick={() => setSuspendRow(u)}
                        >
                          {u.status === 'active' ? (
                            <ShieldOff className="size-4" />
                          ) : (
                            <ShieldCheck className="size-4" />
                          )}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <AlertDialog
        open={editRow !== null}
        onOpenChange={(o) => {
          if (!o) setEditRow(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('table.editRoleTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('table.editRoleDescription', { email: editRow?.email ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="user-role-select">{t('table.editRoleLabel')}</Label>
            <Select value={editRole} onValueChange={(v) => setEditRole(v as UserRole)}>
              <SelectTrigger id="user-role-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {t(`roles.${r}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('table.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={submitEdit} disabled={update.isPending}>
              {t('table.save')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={suspendRow !== null}
        onOpenChange={(o) => {
          if (!o) setSuspendRow(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {suspendRow?.status === 'active'
                ? t('table.suspendTitle')
                : t('table.reactivateTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {suspendRow?.status === 'active'
                ? t('table.suspendDescription', { email: suspendRow?.email ?? '' })
                : t('table.reactivateDescription', { email: suspendRow?.email ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('table.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!suspendRow) return;
                update.mutate({
                  id: suspendRow.id,
                  status: suspendRow.status === 'active' ? 'suspended' : 'active',
                });
              }}
              className={
                suspendRow?.status === 'active'
                  ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                  : undefined
              }
            >
              {suspendRow?.status === 'active'
                ? t('table.confirmSuspend')
                : t('table.confirmReactivate')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
