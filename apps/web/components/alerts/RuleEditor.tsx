'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { api, type ApiError, type ApiSuccess } from '@/lib/api-client';

type Rule = {
  id: string;
  name: string;
  scope: 'global' | 'site';
  siteId: string | null;
  metric: string;
  operator: string;
  threshold: string;
  consecutive: number;
  enabled: boolean;
  channelIds: string[];
};

type Channel = { id: string; name: string; type: string };

const METRICS = [
  'uptime',
  'ssl_expiry',
  'domain_expiry',
  'lighthouse_perf',
  'error_rate',
  'custom',
];
const OPERATORS = ['lt', 'lte', 'gt', 'gte', 'eq'];

export function RuleEditor() {
  const t = useTranslations('pages.alerts.rules');
  const qc = useQueryClient();
  const { data: rulesEnv, isLoading } = useQuery<ApiSuccess<Rule[]>, ApiError>({
    queryKey: ['alerts', 'rules'],
    queryFn: () => api.get('/alert-rules'),
  });
  const { data: channelsEnv } = useQuery<ApiSuccess<Channel[]>, ApiError>({
    queryKey: ['alerts', 'channels'],
    queryFn: () => api.get('/alert-channels'),
  });
  const rules = rulesEnv?.data ?? [];
  const channels = channelsEnv?.data ?? [];
  const channelById = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels]);

  const [draft, setDraft] = useState({
    name: '',
    metric: 'uptime',
    operator: 'gte',
    threshold: '3',
    consecutive: 1,
    channelIds: [] as string[],
  });

  const createMut = useMutation<ApiSuccess<Rule>, ApiError, void>({
    mutationFn: () =>
      api.post('/alert-rules', {
        name: draft.name,
        scope: 'global',
        metric: draft.metric,
        operator: draft.operator,
        threshold: Number.parseFloat(draft.threshold),
        consecutive: draft.consecutive,
        enabled: true,
        channelIds: draft.channelIds,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['alerts', 'rules'] });
      toast.success(t('savedToast'));
      setDraft((d) => ({ ...d, name: '' }));
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMut = useMutation<unknown, ApiError, string>({
    mutationFn: (id) => api.delete(`/alert-rules/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['alerts', 'rules'] });
    },
  });

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t('configuredTitle')}</h3>
        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : rules.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border bg-muted/30 p-6 text-sm text-muted-foreground">
            {t('empty')}
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {rules.map((r) => (
              <li key={r.id} className="space-y-1 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{r.name}</span>
                  <Badge variant="outline">{r.metric}</Badge>
                  <Badge variant="muted">
                    {r.operator} {r.threshold}
                  </Badge>
                  {r.enabled ? (
                    <Badge variant="success">{t('enabledBadge')}</Badge>
                  ) : (
                    <Badge variant="muted">{t('offBadge')}</Badge>
                  )}
                </div>
                <p className="font-mono text-xs text-muted-foreground">{r.id}</p>
                <div className="flex flex-wrap gap-1 pt-1">
                  {r.channelIds.map((id) => {
                    const c = channelById.get(id);
                    return (
                      <Badge key={id} variant="outline">
                        {c ? c.name : id.slice(0, 8)}
                      </Badge>
                    );
                  })}
                  <Button
                    size="sm"
                    variant="destructive"
                    className="ml-auto"
                    onClick={() => deleteMut.mutate(r.id)}
                  >
                    {t('delete')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3 rounded-lg border border-border bg-card p-4 text-sm">
        <h3 className="text-sm font-semibold">{t('addTitle')}</h3>
        <div className="space-y-2">
          <Label htmlFor="r-name">{t('fieldName')}</Label>
          <Input
            id="r-name"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-2">
            <Label>{t('fieldMetric')}</Label>
            <select
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              value={draft.metric}
              onChange={(e) => setDraft({ ...draft, metric: e.target.value })}
            >
              {METRICS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label>{t('fieldOperator')}</Label>
            <select
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              value={draft.operator}
              onChange={(e) => setDraft({ ...draft, operator: e.target.value })}
            >
              {OPERATORS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-2">
            <Label htmlFor="r-threshold">{t('fieldThreshold')}</Label>
            <Input
              id="r-threshold"
              type="number"
              step="0.01"
              value={draft.threshold}
              onChange={(e) => setDraft({ ...draft, threshold: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="r-consec">{t('fieldConsecutive')}</Label>
            <Input
              id="r-consec"
              type="number"
              min={1}
              value={draft.consecutive}
              onChange={(e) =>
                setDraft({ ...draft, consecutive: Number.parseInt(e.target.value, 10) || 1 })
              }
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label>{t('fieldChannels')}</Label>
          <div className="flex flex-wrap gap-1">
            {channels.length === 0 ? (
              <span className="text-xs text-muted-foreground">{t('noChannelsHint')}</span>
            ) : (
              channels.map((c) => {
                const selected = draft.channelIds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        channelIds: selected
                          ? draft.channelIds.filter((id) => id !== c.id)
                          : [...draft.channelIds, c.id],
                      })
                    }
                    className={`rounded-md border px-2 py-1 text-xs ${
                      selected
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {c.name}
                  </button>
                );
              })
            )}
          </div>
        </div>
        <Button onClick={() => createMut.mutate()} disabled={!draft.name || createMut.isPending}>
          {t('save')}
        </Button>
      </section>
    </div>
  );
}
