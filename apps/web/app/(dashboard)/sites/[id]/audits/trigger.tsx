'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { api, type ApiError } from '@/lib/api-client';

export function TriggerAudit({ siteId }: { siteId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [requesting, setRequesting] = useState(false);

  async function run(type: 'seo' | 'lighthouse', asAsync = false) {
    setRequesting(true);
    try {
      const res = await api.post<{
        run?: { id: string };
        summary?: { score: number; total: number };
        enqueued?: boolean;
      }>(`/sites/${siteId}/audits`, { type, async: asAsync });
      if (res.data.enqueued) {
        toast.success(`${type} audit queued`, { description: 'Will run shortly' });
      } else if (res.data.summary) {
        toast.success(`${type} audit complete`, {
          description: `Score ${res.data.summary.score}/100 · ${res.data.summary.total} findings`,
        });
      }
      startTransition(() => router.refresh());
    } catch (err) {
      const e = err as ApiError;
      toast.error(`Could not run ${type} audit`, { description: e.message });
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
        Run SEO audit
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={requesting || pending}
        onClick={() => run('lighthouse', true)}
      >
        Queue Lighthouse
      </Button>
    </div>
  );
}
