'use client';

import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
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

  async function onClick() {
    setRequesting(true);
    try {
      const res = await api.post<{ check: { ok: boolean }; newHealthScore: number }>(
        `/sites/${siteId}/uptime-check`,
      );
      toast.success(res.data.check.ok ? 'Uptime check passed' : 'Uptime check failed', {
        description: `Health score is now ${res.data.newHealthScore}`,
      });
      startTransition(() => {
        router.refresh();
      });
      await queryClient.invalidateQueries({ queryKey: ['sites'] });
    } catch (err) {
      const e = err as ApiError;
      toast.error('Could not check the site', {
        description: e.message ?? 'Unknown error',
      });
    } finally {
      setRequesting(false);
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={onClick} disabled={requesting || pending}>
      <RefreshCw className={requesting ? 'animate-spin' : undefined} />
      Check now
    </Button>
  );
}
