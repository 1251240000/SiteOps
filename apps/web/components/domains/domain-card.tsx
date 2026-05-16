'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Star, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { api, ApiError, type ApiSuccess } from '@/lib/api-client';
import { domainsKeys, type DomainView } from '@/lib/queries/domains';

import { ExpiryCell } from './expiry-cell';

export function DomainCard({ siteId }: { siteId: string }) {
  const queryClient = useQueryClient();
  const t = useTranslations('pages.domains.card');
  const tCommon = useTranslations('common');
  const [addOpen, setAddOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<DomainView | null>(null);

  const { data: envelope, isLoading } = useQuery<ApiSuccess<DomainView[]>, ApiError>({
    queryKey: domainsKeys.forSite(siteId),
    queryFn: () => api.get<DomainView[]>(`/sites/${siteId}/domains`),
  });
  const items = envelope?.data ?? [];

  const setPrimaryMutation = useMutation({
    mutationFn: async (domainId: string) => {
      const { data } = await api.patch<DomainView>(`/domains/${domainId}`, {
        isPrimary: true,
      });
      return data;
    },
    onSuccess: async (data) => {
      toast.success(t('primarySetToast', { domain: data.domain }));
      await invalidateAll();
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (domainId: string) => {
      const { data } = await api.delete<DomainView>(`/domains/${domainId}`);
      return data;
    },
    onSuccess: async (data) => {
      toast.success(t('removedToast', { domain: data.domain }));
      setConfirmDelete(null);
      await invalidateAll();
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  async function invalidateAll() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: domainsKeys.forSite(siteId) }),
      queryClient.invalidateQueries({ queryKey: domainsKeys.lists() }),
    ]);
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">{t('title')}</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
            <Plus className="size-4" /> {t('add')}
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">{t('loading')}</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('empty')}</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {items.map((d) => {
                const onlyOne = items.length === 1;
                const isPrimaryDelete = d.isPrimary;
                return (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="flex flex-col">
                      <span className="flex items-center gap-2 font-medium text-foreground">
                        {d.domain}
                        {d.isPrimary ? (
                          <Badge variant="success" className="gap-1">
                            <Star className="size-3" /> {t('primaryBadge')}
                          </Badge>
                        ) : null}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {t('registrarLine', {
                          registrar: d.registrar ?? '—',
                          dns: d.dnsProvider ?? '—',
                        })}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <ExpiryCell date={d.expiresAt} daysUntil={d.daysUntilDomainExpiry} />
                      <div className="flex items-center gap-1">
                        {!d.isPrimary ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={setPrimaryMutation.isPending}
                            onClick={() => setPrimaryMutation.mutate(d.id)}
                          >
                            {t('makePrimary')}
                          </Button>
                        ) : null}
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={t('deleteAriaLabel', { domain: d.domain })}
                          onClick={() => {
                            if (onlyOne || isPrimaryDelete) setConfirmDelete(d);
                            else deleteMutation.mutate(d.id);
                          }}
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <AddDomainDialog
        siteId={siteId}
        open={addOpen}
        onOpenChange={setAddOpen}
        onAdded={invalidateAll}
        existingPrimary={items.some((d) => d.isPrimary)}
      />

      <AlertDialog open={!!confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('deleteDialogTitle', { domain: confirmDelete?.domain ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete?.isPrimary
                ? t('deleteDialogPrimaryWarning')
                : t('deleteDialogOnlyOneWarning')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              {tCommon('cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (confirmDelete) deleteMutation.mutate(confirmDelete.id);
              }}
            >
              {deleteMutation.isPending ? t('deleting') : t('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function AddDomainDialog({
  siteId,
  open,
  onOpenChange,
  onAdded,
  existingPrimary,
}: {
  siteId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => Promise<void>;
  existingPrimary: boolean;
}) {
  const [domain, setDomain] = useState('');
  const [registrar, setRegistrar] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [isPrimary, setIsPrimary] = useState(!existingPrimary);
  const [submitting, setSubmitting] = useState(false);

  const t = useTranslations('pages.domains.card.addDialog');
  const tCommon = useTranslations('common');

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post(`/sites/${siteId}/domains`, {
        domain,
        registrar: registrar || undefined,
        expiresAt: expiresAt || undefined,
        isPrimary,
      });
      toast.success(t('addedToast', { domain }));
      await onAdded();
      onOpenChange(false);
      setDomain('');
      setRegistrar('');
      setExpiresAt('');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('failedToast');
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="add-domain">{t('fieldDomain')}</Label>
            <Input
              id="add-domain"
              required
              autoFocus
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder={t('fieldDomainPlaceholder')}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="add-registrar">{t('fieldRegistrar')}</Label>
              <Input
                id="add-registrar"
                value={registrar}
                onChange={(e) => setRegistrar(e.target.value)}
                placeholder={t('fieldRegistrarPlaceholder')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-expires">{t('fieldExpires')}</Label>
              <Input
                id="add-expires"
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isPrimary}
              onChange={(e) => setIsPrimary(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            {t('setPrimary')}
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel type="button" disabled={submitting}>
              {tCommon('cancel')}
            </AlertDialogCancel>
            <AlertDialogAction type="submit" disabled={submitting}>
              {submitting ? t('submitting') : t('submit')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
