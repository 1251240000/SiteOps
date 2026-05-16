'use client';

import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { api, type ApiError } from '@/lib/api-client';

/** Manual "check now" button. Runs an inline probe via the API. */
export function TriggerUptimeCheck({ siteId }: { siteId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pending, startTransition] = useTransition();
  const [requesting, setRequesting] = useState(false);
  const t = useTranslations('pages.uptime.trigger');

  async function onClick() {
    setRequesting(true);
    try {
      const res = await api.post<{ check: { ok: boolean }; newHealthScore: number }>(
        `/sites/${siteId}/uptime-check`,
      );
      toast.success(res.data.check.ok ? t('passedToast') : t('failedToast'), {
        description: t('healthScoreDescription', { score: res.data.newHealthScore }),
      });
      startTransition(() => {
        router.refresh();
      });
      await queryClient.invalidateQueries({ queryKey: ['sites'] });
    } catch (err) {
      const e = err as ApiError;
      toast.error(t('errorToast'), {
        description: e.message ?? t('unknownError'),
      });
    } finally {
      setRequesting(false);
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={onClick} disabled={requesting || pending}>
      <RefreshCw className={requesting ? 'animate-spin' : undefined} />
      {t('checkNow')}
    </Button>
  );
}
