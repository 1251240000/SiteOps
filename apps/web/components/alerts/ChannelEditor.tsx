'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { api, type ApiError, type ApiSuccess } from '@/lib/api-client';

type ChannelRow = {
  id: string;
  name: string;
  type: 'webhook' | 'email' | 'feishu' | 'dingtalk' | 'slack' | 'telegram';
  enabled: boolean;
  createdAt: string;
};

const TYPES: ChannelRow['type'][] = ['webhook', 'feishu', 'dingtalk', 'slack', 'telegram', 'email'];

const SAMPLE_CONFIGS: Record<ChannelRow['type'], string> = {
  webhook: '{\n  "url": "https://example.com/hook"\n}',
  feishu:
    '{\n  "webhookUrl": "https://open.feishu.cn/open-apis/bot/v2/hook/...",\n  "secret": "optional"\n}',
  dingtalk:
    '{\n  "webhookUrl": "https://oapi.dingtalk.com/robot/send?access_token=...",\n  "secret": "optional"\n}',
  slack: '{\n  "webhookUrl": "https://hooks.slack.com/services/..."\n}',
  telegram: '{\n  "botToken": "123:abc",\n  "chatId": "-100123456"\n}',
  email: '{\n  "to": "ops@example.com"\n}',
};

export function ChannelEditor() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<ApiSuccess<ChannelRow[]>, ApiError>({
    queryKey: ['alerts', 'channels'],
    queryFn: () => api.get('/alert-channels'),
  });
  const items = data?.data ?? [];

  const [draft, setDraft] = useState({
    name: '',
    type: 'webhook' as ChannelRow['type'],
    configText: SAMPLE_CONFIGS['webhook'],
  });

  const createMut = useMutation<ApiSuccess<ChannelRow>, ApiError, void>({
    mutationFn: async () => {
      let config: unknown;
      try {
        config = JSON.parse(draft.configText);
      } catch {
        throw new Error('Config is not valid JSON');
      }
      return api.post('/alert-channels', {
        name: draft.name,
        type: draft.type,
        config,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['alerts', 'channels'] });
      toast.success('Channel saved');
      setDraft((d) => ({ ...d, name: '' }));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation<unknown, ApiError, string>({
    mutationFn: (id) => api.delete(`/alert-channels/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['alerts', 'channels'] });
      toast.success('Channel deleted');
    },
    onError: (e) => toast.error(e.message),
  });

  const testMut = useMutation<unknown, ApiError, string>({
    mutationFn: (id) => api.post(`/alert-channels/${id}/test`, {}),
    onSuccess: (res) => {
      const r = (res as { data: { ok: boolean; error?: string } }).data;
      if (r.ok) toast.success('Test message sent');
      else toast.error(`Test failed: ${r.error ?? 'unknown'}`);
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Configured channels</h3>
        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border bg-muted/30 p-6 text-sm text-muted-foreground">
            No channels yet. Add one on the right.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {items.map((c) => (
              <li key={c.id} className="flex items-center justify-between p-3 text-sm">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{c.name}</span>
                    <Badge variant="outline">{c.type}</Badge>
                    {c.enabled ? null : <Badge variant="muted">disabled</Badge>}
                  </div>
                  <span className="font-mono text-xs text-muted-foreground">{c.id}</span>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => testMut.mutate(c.id)}>
                    Test
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => deleteMut.mutate(c.id)}>
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3 rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-semibold">Add channel</h3>
        <div className="space-y-2">
          <Label htmlFor="ch-name">Name</Label>
          <Input
            id="ch-name"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="ops · feishu"
          />
        </div>
        <div className="space-y-2">
          <Label>Type</Label>
          <div className="flex flex-wrap gap-1">
            {TYPES.map((t) => (
              <button
                type="button"
                key={t}
                onClick={() => setDraft({ ...draft, type: t, configText: SAMPLE_CONFIGS[t] })}
                className={`rounded-md border px-2 py-1 text-xs ${
                  draft.type === t
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="ch-config">Config (JSON)</Label>
          <Textarea
            id="ch-config"
            value={draft.configText}
            onChange={(e) => setDraft({ ...draft, configText: e.target.value })}
            rows={8}
            className="font-mono text-xs"
          />
        </div>
        <Button onClick={() => createMut.mutate()} disabled={!draft.name || createMut.isPending}>
          Save channel
        </Button>
      </section>
    </div>
  );
}
