'use client';

import { CalendarDays } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { parseAsString, useQueryState } from 'nuqs';
import { useEffect, useMemo, useState, type ChangeEvent } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { resolveRange } from '@/lib/date-range';
import { cn } from '@/lib/utils';

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const PRESETS: ReadonlyArray<{ key: '7d' | '30d' | '90d'; days: number }> = [
  { key: '7d', days: 7 },
  { key: '30d', days: 30 },
  { key: '90d', days: 90 },
];

function isoToday(): string {
  const d = new Date();
  return [
    d.getUTCFullYear().toString().padStart(4, '0'),
    (d.getUTCMonth() + 1).toString().padStart(2, '0'),
    d.getUTCDate().toString().padStart(2, '0'),
  ].join('-');
}

function isoMinusDays(base: string, days: number): string {
  const ts = Date.parse(`${base}T00:00:00Z`);
  const d = new Date(ts - days * MS_PER_DAY);
  return [
    d.getUTCFullYear().toString().padStart(4, '0'),
    (d.getUTCMonth() + 1).toString().padStart(2, '0'),
    d.getUTCDate().toString().padStart(2, '0'),
  ].join('-');
}

/**
 * URL-state-driven date range picker. Used by `/traffic`, `/sites/[id]/traffic`,
 * and (later) the revenue / ROI dashboards in T23 / T24.
 *
 * Presets click-set both `from` and `to` in a single URL transition; the
 * "Custom" inputs let an operator drill into a specific window without
 * leaving the page.
 */
export function DateRangePicker({ defaultDays = 30 }: { defaultDays?: number } = {}) {
  const t = useTranslations('pages.traffic.rangePicker');
  const [from, setFrom] = useQueryState('from', parseAsString);
  const [to, setTo] = useQueryState('to', parseAsString);

  const resolved = useMemo(() => resolveRange(from, to, defaultDays), [from, to, defaultDays]);

  const [draftFrom, setDraftFrom] = useState(resolved.from);
  const [draftTo, setDraftTo] = useState(resolved.to);

  // Sync URL → form when ?from/?to change (back/forward, preset clicks).
  useEffect(() => {
    setDraftFrom(resolved.from);
    setDraftTo(resolved.to);
  }, [resolved.from, resolved.to]);

  const activePreset = (() => {
    if (resolved.to !== isoToday()) return null;
    const days =
      Math.round(
        (Date.parse(`${resolved.to}T00:00:00Z`) - Date.parse(`${resolved.from}T00:00:00Z`)) /
          MS_PER_DAY,
      ) + 1;
    return PRESETS.find((p) => p.days === days)?.key ?? null;
  })();

  function applyPreset(days: number) {
    const t = isoToday();
    const f = isoMinusDays(t, days - 1);
    void setFrom(f);
    void setTo(t);
  }

  function commit(next: { from?: string; to?: string }) {
    const nextFrom = next.from ?? draftFrom;
    const nextTo = next.to ?? draftTo;
    if (!ISO_RE.test(nextFrom) || !ISO_RE.test(nextTo)) return;
    if (Date.parse(`${nextFrom}T00:00:00Z`) > Date.parse(`${nextTo}T00:00:00Z`)) return;
    void setFrom(nextFrom);
    void setTo(nextTo);
  }

  return (
    <section
      aria-label={t('ariaLabel')}
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 md:flex-row md:items-end md:gap-4"
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground md:pb-2">
        <CalendarDays className="size-4" aria-hidden />
        <span>{t('rangeLabel')}</span>
      </div>

      <div role="group" aria-label={t('presetsAriaLabel')} className="flex flex-wrap gap-1">
        {PRESETS.map((p) => {
          const active = activePreset === p.key;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => applyPreset(p.days)}
              aria-pressed={active}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                active
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
              )}
            >
              {t('presetDays', { days: p.days })}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-3">
        <div className="space-y-1">
          <Label htmlFor="range-from" className="text-xs text-muted-foreground">
            {t('from')}
          </Label>
          <Input
            id="range-from"
            type="date"
            value={draftFrom}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setDraftFrom(e.target.value)}
            onBlur={() => commit({ from: draftFrom })}
            className="h-8 w-[140px] text-xs"
            max={draftTo}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="range-to" className="text-xs text-muted-foreground">
            {t('to')}
          </Label>
          <Input
            id="range-to"
            type="date"
            value={draftTo}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setDraftTo(e.target.value)}
            onBlur={() => commit({ to: draftTo })}
            className="h-8 w-[140px] text-xs"
            min={draftFrom}
            max={isoToday()}
          />
        </div>
      </div>
    </section>
  );
}
