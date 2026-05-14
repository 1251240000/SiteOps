'use client';

import { Search } from 'lucide-react';
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

const EXPIRY_PRESETS: { label: string; value: string }[] = [
  { label: 'All', value: '' },
  { label: '7 days', value: '7' },
  { label: '30 days', value: '30' },
  { label: '90 days', value: '90' },
  { label: '180 days', value: '180' },
];

const ANY = '__any__';

export function DomainFilters() {
  const [q, setQ] = useQueryState('q', parseAsString.withDefault(''));
  const [expiring, setExpiring] = useQueryState(
    'expiringWithinDays',
    parseAsString.withDefault(''),
  );
  const [, setPage] = useQueryState('page', parseAsString.withDefault(''));
  const [draft, setDraft] = useState(q);

  useEffect(() => {
    const t = setTimeout(() => {
      if (draft !== q) {
        void setQ(draft || null);
        void setPage(null);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [draft, q, setQ, setPage]);

  useEffect(() => {
    setDraft(q);
  }, [q]);

  return (
    <section
      aria-label="Domain filters"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 md:flex-row md:items-end md:gap-4"
    >
      <div className="flex-1 space-y-1.5">
        <Label htmlFor="domain-q">Search</Label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="domain-q"
            value={draft}
            placeholder="Domain or registrar…"
            className="pl-8"
            onChange={(e) => setDraft(e.target.value)}
          />
        </div>
      </div>

      <div className="w-full space-y-1.5 md:w-48">
        <Label htmlFor="domain-expiry">Expiring within</Label>
        <Select
          value={expiring || ANY}
          onValueChange={(v) => {
            void setExpiring(v === ANY ? null : v);
            void setPage(null);
          }}
        >
          <SelectTrigger id="domain-expiry">
            <SelectValue placeholder="All" />
          </SelectTrigger>
          <SelectContent>
            {EXPIRY_PRESETS.map((p) => (
              <SelectItem key={p.value || ANY} value={p.value || ANY}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </section>
  );
}
