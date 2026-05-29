'use client';

import { Copy } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { buildAnalyticsInstallSnippet } from '@/lib/analytics-install-snippet';

export function AnalyticsInstallCard({
  appOrigin,
  publicAnalyticsKey,
  primaryUrl,
}: {
  appOrigin: string;
  publicAnalyticsKey: string;
  primaryUrl: string;
}) {
  const t = useTranslations('pages.sites.form.analyticsInstall');
  const snippet = useMemo(
    () => buildAnalyticsInstallSnippet({ appOrigin, publicAnalyticsKey }),
    [appOrigin, publicAnalyticsKey],
  );

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(snippet);
      toast.success(t('copiedToast'));
    } catch {
      toast.error(t('copyFailedToast'));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label>{t('publicKeyLabel')}</Label>
          <Input value={publicAnalyticsKey} readOnly className="font-mono text-xs" />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-3">
            <Label>{t('snippetLabel')}</Label>
            <Button type="button" variant="outline" size="sm" onClick={copySnippet}>
              <Copy aria-hidden="true" />
              {t('copy')}
            </Button>
          </div>
          <Textarea value={snippet} readOnly rows={5} className="font-mono text-xs" />
        </div>
        <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
          <p>{t('installHint')}</p>
          <p className="mt-2">{t('originHint', { primaryUrl })}</p>
          <p className="mt-2">{t('piiHint')}</p>
        </div>
      </CardContent>
    </Card>
  );
}
