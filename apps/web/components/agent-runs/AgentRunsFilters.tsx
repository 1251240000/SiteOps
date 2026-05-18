'use client';

import { Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { parseAsString, useQueryState } from 'nuqs';
import { type ChangeEvent } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const STATUS_OPTIONS = ['', 'success', 'failed'] as const;

/**
 * URL-driven filter bar for the agent-runs dashboard. All filter state
 * lives in the URL so deep links / browser back-forward "just work".
 *
 * Filters wired:
 *   - `status` — success/failed/any
 *   - `action` — exact or `tasks.*` prefix (free text)
 *   - `agentName` — exact match (free text)
 */
export function AgentRunsFilters() {
  const t = useTranslations('pages.agentRuns.filters');
  const [status, setStatus] = useQueryState('status', parseAsString.withDefault(''));
  const [action, setAction] = useQueryState('action', parseAsString.withDefault(''));
  const [agentName, setAgentName] = useQueryState('agentName', parseAsString.withDefault(''));

  return (
    <section
      aria-label={t('ariaLabel')}
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 md:flex-row md:items-end md:gap-4"
    >
      <div className="flex flex-1 flex-col gap-1">
        <Label htmlFor="filter-action" className="text-xs text-muted-foreground">
          {t('actionLabel')}
        </Label>
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id="filter-action"
            value={action}
            placeholder={t('actionPlaceholder')}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              const v = e.target.value;
              void setAction(v.length === 0 ? null : v);
            }}
            className="h-8 pl-7 text-xs"
          />
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-1">
        <Label htmlFor="filter-agent" className="text-xs text-muted-foreground">
          {t('agentLabel')}
        </Label>
        <Input
          id="filter-agent"
          value={agentName}
          placeholder={t('agentPlaceholder')}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            const v = e.target.value;
            void setAgentName(v.length === 0 ? null : v);
          }}
          className="h-8 text-xs"
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label className="text-xs text-muted-foreground" htmlFor="filter-status">
          {t('statusLabel')}
        </Label>
        <Select
          value={status === '' ? 'any' : status}
          onValueChange={(v) => {
            void setStatus(v === 'any' ? null : v);
          }}
        >
          <SelectTrigger id="filter-status" className="h-8 w-[140px] text-xs">
            <SelectValue placeholder={t('anyStatus')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">{t('anyStatus')}</SelectItem>
            {STATUS_OPTIONS.filter((s): s is 'success' | 'failed' => s !== '').map((s) => (
              <SelectItem key={s} value={s}>
                {t(`status.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </section>
  );
}
