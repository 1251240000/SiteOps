'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, Loader2, UserPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
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
import { api, type ApiError, type ApiSuccess } from '@/lib/api-client';
import { usersKeys, type InvitationResponse, type UserRole } from '@/lib/queries/users';

const ROLES: UserRole[] = ['operator', 'viewer', 'admin'];

/**
 * Two-stage modal:
 *
 *   stage 1 — admin enters email + role
 *   stage 2 — backend returns the public invite link; we lock the dialog
 *             open and surface a copy button. There is no email delivery
 *             integration in T40 — admin shares the link manually.
 */
export function InviteUserDialog() {
  const t = useTranslations('pages.users.invite');
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('viewer');
  const [issued, setIssued] = useState<InvitationResponse | null>(null);

  function reset(): void {
    setEmail('');
    setRole('viewer');
    setIssued(null);
  }

  const create = useMutation<
    ApiSuccess<InvitationResponse>,
    ApiError,
    { email: string; role: UserRole }
  >({
    mutationFn: (input) => api.post<InvitationResponse>('/users/invitations', input),
    onSuccess: (res) => {
      setIssued(res.data);
      void qc.invalidateQueries({ queryKey: usersKeys.lists() });
    },
    onError: (err) => toast.error(err.message || t('errorGeneric')),
  });

  function onSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      toast.error(t('errorEmailRequired'));
      return;
    }
    create.mutate({ email: trimmed, role });
  }

  async function copyLink(): Promise<void> {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.inviteUrl);
      toast.success(t('copiedToast'));
    } catch {
      toast.error(t('copyFailed'));
    }
  }

  function handleOpenChange(next: boolean): void {
    setOpen(next);
    if (!next) reset();
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogTrigger asChild>
        <Button type="button" size="sm">
          <UserPlus className="mr-2 size-4" />
          {t('triggerLabel')}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="max-w-lg">
        {issued ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('issuedTitle')}</AlertDialogTitle>
              <AlertDialogDescription>{t('issuedDescription')}</AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-2">
              <Label>{t('inviteUrlLabel')}</Label>
              <div className="flex items-center gap-2">
                <Input readOnly value={issued.inviteUrl} className="font-mono text-xs" />
                <Button
                  type="button"
                  size="icon"
                  variant="secondary"
                  onClick={() => void copyLink()}
                  aria-label={t('copyAria')}
                >
                  <Copy className="size-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('expiresHint', {
                  date: new Date(issued.invitation.expiresAt).toLocaleString(),
                })}
              </p>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('done')}</AlertDialogCancel>
            </AlertDialogFooter>
          </>
        ) : (
          <form onSubmit={onSubmit}>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('formTitle')}</AlertDialogTitle>
              <AlertDialogDescription>{t('formDescription')}</AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="invite-email">{t('emailLabel')}</Label>
                <Input
                  id="invite-email"
                  type="email"
                  required
                  autoComplete="off"
                  placeholder="user@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invite-role">{t('roleLabel')}</Label>
                <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
                  <SelectTrigger id="invite-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {t(`role.${r}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{t(`roleHint.${role}`)}</p>
              </div>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel type="button">{t('cancel')}</AlertDialogCancel>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                {t('submit')}
              </Button>
            </AlertDialogFooter>
          </form>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
