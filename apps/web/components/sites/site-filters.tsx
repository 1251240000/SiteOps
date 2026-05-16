'use client';

import { Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { parseAsBoolean, parseAsString, useQueryState } from 'nuqs';
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
import { SITE_STATUS, SITE_TYPES } from '@siteops/shared/constants';

const ANY_VALUE = '__any__';

/**
 * URL-state filter bar for `/sites`. Powered by `nuqs` so refresh keeps the
 * full filter set, and the back button cycles through filter history. The
 * search input debounces by 250 ms to keep the network quiet while typing.
 */
export function SiteFilters() {
  const t = useTranslations('pages.sites.filters');
  const tEnumStatus = useTranslations('enums.siteStatus');
  const tEnumType = useTranslations('enums.siteType');
  const [q, setQ] = useQueryState('q', parseAsString.withDefault(''));
  const [siteType, setSiteType] = useQueryState('siteType', parseAsString.withDefault(''));
  const [status, setStatus] = useQueryState('status', parseAsString.withDefault(''));
  const [archived, setArchived] = useQueryState('archived', parseAsBoolean.withDefault(false));
  const [, setPage] = useQueryState('page', parseAsString.withDefault(''));

  const [draftQ, setDraftQ] = useState(q);

  // Debounced search write-through.
  useEffect(() => {
    const handle = setTimeout(() => {
      if (draftQ !== q) {
        void setQ(draftQ || null);
        void setPage(null);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [draftQ, q, setQ, setPage]);

  useEffect(() => {
    // Sync incoming URL changes (back/forward) into the controlled input.
    setDraftQ(q);
  }, [q]);

  function resetPage() {
    void setPage(null);
  }

  return (
    <section
      aria-label={t('ariaLabel')}
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 md:flex-row md:items-end md:gap-4"
    >
      <div className="flex-1 space-y-1.5">
        <Label htmlFor="filter-q">{t('search')}</Label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="filter-q"
            value={draftQ}
            placeholder={t('searchPlaceholder')}
            className="pl-8"
            onChange={(e) => setDraftQ(e.target.value)}
          />
        </div>
      </div>

      <div className="w-full space-y-1.5 md:w-40">
        <Label htmlFor="filter-type">{t('typeLabel')}</Label>
        <Select
          value={siteType || ANY_VALUE}
          onValueChange={(v) => {
            void setSiteType(v === ANY_VALUE ? null : v);
            resetPage();
          }}
        >
          <SelectTrigger id="filter-type">
            <SelectValue placeholder={t('anyPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY_VALUE}>{t('anyType')}</SelectItem>
            {SITE_TYPES.map((siteTypeKey) => (
              <SelectItem key={siteTypeKey} value={siteTypeKey}>
                {tEnumType(siteTypeKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="w-full space-y-1.5 md:w-40">
        <Label htmlFor="filter-status">{t('statusLabel')}</Label>
        <Select
          value={status || ANY_VALUE}
          onValueChange={(v) => {
            void setStatus(v === ANY_VALUE ? null : v);
            resetPage();
          }}
        >
          <SelectTrigger id="filter-status">
            <SelectValue placeholder={t('anyPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY_VALUE}>{t('anyStatus')}</SelectItem>
            {SITE_STATUS.map((statusKey) => (
              <SelectItem key={statusKey} value={statusKey}>
                {tEnumStatus(statusKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <label className="flex items-center gap-2 text-sm text-muted-foreground md:pb-1">
        <input
          type="checkbox"
          checked={archived}
          onChange={(e) => {
            void setArchived(e.target.checked || null);
            resetPage();
          }}
          className="h-4 w-4 rounded border-input"
        />
        {t('showArchived')}
      </label>
    </section>
  );
}
