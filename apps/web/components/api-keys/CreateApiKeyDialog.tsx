'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Loader2 } from 'lucide-react';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, type ApiError, type ApiSuccess } from '@/lib/api-client';
import { apiKeysKeys, type CreateApiKeyResponse } from '@/lib/queries/api-keys';
// Narrow subpath import: the root barrel re-exports server-only utils
// (e.g. `ssrf.ts` → `node:net`), which Turbopack can't tree-shake out of a
// client bundle and surfaces as a build-error overlay site-wide.
import { API_KEY_SCOPES, API_KEY_WILDCARD } from '@siteops/shared/constants';

const ALL_SCOPES: string[] = [API_KEY_WILDCARD, ...API_KEY_SCOPES];

/**
 * Two-stage modal:
 *
 *   stage 1 — admin fills in `name` + `scopes` (+ optional `expiresAt`)
 *   stage 2 — backend returns plaintext; we lock the dialog open and show
 *             the token with a one-shot copy button. Closing the modal is
 *             treated as "I have stored the secret" and the cache is
 *             invalidated so the new row appears in the list.
 */
export function CreateApiKeyDialog() {
  const t = useTranslations('pages.apiKeys.create');
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['errors:write']);
  const [expiresAt, setExpiresAt] = useState('');
  // Empty string = "use env default"; otherwise must parse as a positive int.
  const [rateLimitPerMin, setRateLimitPerMin] = useState('');
  const [issued, setIssued] = useState<CreateApiKeyResponse | null>(null);

  function reset(): void {
    setName('');
    setScopes(['errors:write']);
    setExpiresAt('');
    setRateLimitPerMin('');
    setIssued(null);
  }

  function toggleScope(scope: string): void {
    setScopes((prev) => {
      if (scope === API_KEY_WILDCARD) return prev.includes(scope) ? [] : [API_KEY_WILDCARD];
      const without = prev.filter((s) => s !== API_KEY_WILDCARD);
      return without.includes(scope) ? without.filter((s) => s !== scope) : [...without, scope];
    });
  }

  const create = useMutation<
    ApiSuccess<CreateApiKeyResponse>,
    ApiError,
    { name: string; scopes: string[]; expiresAt?: string; rateLimitPerMin?: number }
  >({
    mutationFn: (input) => api.post<CreateApiKeyResponse>('/settings/api-keys', input),
    onSuccess: (res) => {
      setIssued(res.data);
      void qc.invalidateQueries({ queryKey: apiKeysKeys.lists() });
    },
    onError: (err) => toast.error(err.message || t('errorGeneric')),
  });

  function onSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    // Only forward `rateLimitPerMin` if the admin actually typed a positive
    // integer — otherwise the server uses the env default. We deliberately
    // don't try to be clever about clamping; let the Zod layer reject bad
    // values so the UI shows the same error a curl would.
    const trimmed = rateLimitPerMin.trim();
    const parsedRate = trimmed === '' ? undefined : Number(trimmed);
    create.mutate({
      name: name.trim(),
      scopes,
      ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
      ...(parsedRate !== undefined && Number.isFinite(parsedRate) && parsedRate > 0
        ? { rateLimitPerMin: Math.floor(parsedRate) }
        : {}),
    });
  }

  async function copyPlaintext(): Promise<void> {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.plaintext);
      toast.success(t('copiedToast'));
    } catch {
      toast.error(t('copyFailed'));
    }
  }

  function onOpenChange(next: boolean): void {
    setOpen(next);
    if (!next) reset();
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogTrigger asChild>
        <Button size="sm">
          <KeyRound className="mr-1 size-4" /> {t('trigger')}
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
              <Label className="text-xs text-muted-foreground">{t('plaintextLabel')}</Label>
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 p-2">
                <code className="flex-1 select-all break-all font-mono text-xs">
                  {issued.plaintext}
                </code>
                <Button type="button" size="icon" variant="ghost" onClick={copyPlaintext}>
                  <Copy className="size-4" />
                </Button>
              </div>
              <p className="text-xs text-destructive">{t('warnOnce')}</p>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('done')}</AlertDialogCancel>
            </AlertDialogFooter>
          </>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <AlertDialogHeader>
              <AlertDialogTitle>{t('title')}</AlertDialogTitle>
              <AlertDialogDescription>{t('description')}</AlertDialogDescription>
            </AlertDialogHeader>

            <div className="space-y-2">
              <Label htmlFor="api-key-name">{t('nameLabel')}</Label>
              <Input
                id="api-key-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('namePlaceholder')}
                required
                maxLength={120}
              />
            </div>

            <div className="space-y-2">
              <Label>{t('scopesLabel')}</Label>
              <div className="flex flex-wrap gap-2">
                {ALL_SCOPES.map((scope) => {
                  const active = scopes.includes(scope);
                  return (
                    <button
                      key={scope}
                      type="button"
                      onClick={() => toggleScope(scope)}
                      className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full"
                      aria-pressed={active}
                    >
                      <Badge
                        variant={active ? 'default' : 'secondary'}
                        className="cursor-pointer font-mono text-[11px]"
                      >
                        {scope}
                      </Badge>
                    </button>
                  );
                })}
              </div>
              {scopes.length === 0 ? (
                <p className="text-xs text-destructive">{t('scopesRequired')}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="api-key-expires">{t('expiresAtLabel')}</Label>
              <Input
                id="api-key-expires"
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t('expiresAtHint')}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="api-key-rate-limit">{t('rateLimitLabel')}</Label>
              <Input
                id="api-key-rate-limit"
                type="number"
                inputMode="numeric"
                min={1}
                max={100000}
                step={1}
                value={rateLimitPerMin}
                onChange={(e) => setRateLimitPerMin(e.target.value)}
                placeholder={t('rateLimitPlaceholder')}
              />
              <p className="text-xs text-muted-foreground">{t('rateLimitHint')}</p>
            </div>

            <AlertDialogFooter>
              <AlertDialogCancel asChild>
                <Button type="button" variant="ghost">
                  {t('cancel')}
                </Button>
              </AlertDialogCancel>
              <Button
                type="submit"
                disabled={create.isPending || scopes.length === 0 || name.trim().length === 0}
              >
                {create.isPending ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
                {t('submit')}
              </Button>
            </AlertDialogFooter>
          </form>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
