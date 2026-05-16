'use client';

import { Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { parseAsString, useQueryState } from 'nuqs';
import { useEffect, useState } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const EXPIRY_PRESET_DAYS = [7, 30, 90, 180] as const;

const ANY = '__any__';

export function DomainFilters() {
  const t = useTranslations('pages.domains.filters');
  const [q, setQ] = useQueryState('q', parseAsString.withDefault(''));
  const [expiring, setExpiring] = useQueryState(
    'expiringWithinDays',
    parseAsString.withDefault(''),
  );
  const [, setPage] = useQueryState('page', parseAsString.withDefault(''));
  const [draft, setDraft] = useState(q);

  useEffect(() => {
    const handle = setTimeout(() => {
      if (draft !== q) {
        void setQ(draft || null);
        void setPage(null);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [draft, q, setQ, setPage]);

  useEffect(() => {
    setDraft(q);
  }, [q]);

  return (
    <section
      aria-label={t('ariaLabel')}
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 md:flex-row md:items-end md:gap-4"
    >
      <div className="flex-1 space-y-1.5">
        <Label htmlFor="domain-q">{t('search')}</Label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="domain-q"
            value={draft}
            placeholder={t('searchPlaceholder')}
            className="pl-8"
            onChange={(e) => setDraft(e.target.value)}
          />
        </div>
      </div>

      <div className="w-full space-y-1.5 md:w-48">
        <Label htmlFor="domain-expiry">{t('expiringWithin')}</Label>
        <Select
          value={expiring || ANY}
          onValueChange={(v) => {
            void setExpiring(v === ANY ? null : v);
            void setPage(null);
          }}
        >
          <SelectTrigger id="domain-expiry">
            <SelectValue placeholder={t('expiryAll')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>{t('expiryAll')}</SelectItem>
            {EXPIRY_PRESET_DAYS.map((days) => (
              <SelectItem key={days} value={String(days)}>
                {t('expiryDays', { days })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </section>
  );
}
