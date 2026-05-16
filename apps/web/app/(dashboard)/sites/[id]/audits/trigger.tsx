'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { api, type ApiError } from '@/lib/api-client';

export function TriggerAudit({ siteId }: { siteId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [requesting, setRequesting] = useState(false);
  const t = useTranslations('pages.audits.trigger');

  async function run(type: 'seo' | 'lighthouse', asAsync = false) {
    setRequesting(true);
    try {
      const res = await api.post<{
        run?: { id: string };
        summary?: { score: number; total: number };
        enqueued?: boolean;
      }>(`/sites/${siteId}/audits`, { type, async: asAsync });
      if (res.data.enqueued) {
        toast.success(t('queuedTitle', { type }), { description: t('queuedDescription') });
      } else if (res.data.summary) {
        toast.success(t('completeTitle', { type }), {
          description: t('completeDescription', {
            score: res.data.summary.score,
            total: res.data.summary.total,
          }),
        });
      }
      startTransition(() => router.refresh());
    } catch (err) {
      const e = err as ApiError;
      toast.error(t('failedToast', { type }), { description: e.message });
    } finally {
      setRequesting(false);
    }
  }

  return (
    <div className="flex gap-2">
      <Button
        variant="default"
        size="sm"
        disabled={requesting || pending}
        onClick={() => run('seo', false)}
      >
        {t('runSeo')}
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={requesting || pending}
        onClick={() => run('lighthouse', true)}
      >
        {t('queueLighthouse')}
      </Button>
    </div>
  );
}
