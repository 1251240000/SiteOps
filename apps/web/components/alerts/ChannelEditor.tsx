'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
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
  const t = useTranslations('pages.alerts.channels');
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
        throw new Error(t('invalidJson'));
      }
      return api.post('/alert-channels', {
        name: draft.name,
        type: draft.type,
        config,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['alerts', 'channels'] });
      toast.success(t('savedToast'));
      setDraft((d) => ({ ...d, name: '' }));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation<unknown, ApiError, string>({
    mutationFn: (id) => api.delete(`/alert-channels/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['alerts', 'channels'] });
      toast.success(t('deletedToast'));
    },
    onError: (e) => toast.error(e.message),
  });

  const testMut = useMutation<unknown, ApiError, string>({
    mutationFn: (id) => api.post(`/alert-channels/${id}/test`, {}),
    onSuccess: (res) => {
      const r = (res as { data: { ok: boolean; error?: string } }).data;
      if (r.ok) toast.success(t('testSentToast'));
      else toast.error(t('testFailedToast', { error: r.error ?? t('testUnknownError') }));
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t('configuredTitle')}</h3>
        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border bg-muted/30 p-6 text-sm text-muted-foreground">
            {t('empty')}
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {items.map((c) => (
              <li key={c.id} className="flex items-center justify-between p-3 text-sm">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{c.name}</span>
                    <Badge variant="outline">{c.type}</Badge>
                    {c.enabled ? null : <Badge variant="muted">{t('disabledBadge')}</Badge>}
                  </div>
                  <span className="font-mono text-xs text-muted-foreground">{c.id}</span>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => testMut.mutate(c.id)}>
                    {t('test')}
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => deleteMut.mutate(c.id)}>
                    {t('delete')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3 rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-semibold">{t('addTitle')}</h3>
        <div className="space-y-2">
          <Label htmlFor="ch-name">{t('fieldName')}</Label>
          <Input
            id="ch-name"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder={t('fieldNamePlaceholder')}
          />
        </div>
        <div className="space-y-2">
          <Label>{t('fieldType')}</Label>
          <div className="flex flex-wrap gap-1">
            {TYPES.map((typeKey) => (
              <button
                type="button"
                key={typeKey}
                onClick={() =>
                  setDraft({ ...draft, type: typeKey, configText: SAMPLE_CONFIGS[typeKey] })
                }
                className={`rounded-md border px-2 py-1 text-xs ${
                  draft.type === typeKey
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                {typeKey}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="ch-config">{t('fieldConfig')}</Label>
          <Textarea
            id="ch-config"
            value={draft.configText}
            onChange={(e) => setDraft({ ...draft, configText: e.target.value })}
            rows={8}
            className="font-mono text-xs"
          />
        </div>
        <Button onClick={() => createMut.mutate()} disabled={!draft.name || createMut.isPending}>
          {t('save')}
        </Button>
      </section>
    </div>
  );
}
