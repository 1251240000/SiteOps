'use client';

import { type ColumnDef } from '@tanstack/react-table';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { DataTable } from '@/components/common/data-table';

type ActivityRow = {
  id: string;
  site: string;
  event: 'deploy' | 'alert' | 'audit';
  status: 'ok' | 'warn' | 'fail';
  durationMs: number;
  at: string;
};

const SITES = [
  'docs.example.com',
  'app.example.com',
  'blog.example.com',
  'shop.example.com',
  'status.example.com',
] as const;
const EVENTS = ['deploy', 'alert', 'audit'] as const;
const STATUSES = ['ok', 'warn', 'fail'] as const;

/** Tiny deterministic PRNG so the demo dataset is stable across renders. */
function mulberry32(seed: number): () => number {
  return function rand() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateRows(n: number): ActivityRow[] {
  const rand = mulberry32(0xc0ffee);
  // Anchor "now" so server-rendered HTML matches the first client render.
  const anchor = new Date('2026-05-13T16:00:00Z').getTime();
  return Array.from({ length: n }, (_, i) => {
    const event = EVENTS[Math.floor(rand() * EVENTS.length)]!;
    const status = STATUSES[Math.floor(rand() * STATUSES.length)]!;
    const at = new Date(anchor - i * 1000 * 60 * 7 - Math.floor(rand() * 60_000));
    return {
      id: `act_${(i + 1).toString().padStart(3, '0')}`,
      site: SITES[Math.floor(rand() * SITES.length)]!,
      event,
      status,
      durationMs: Math.floor(rand() * 3000) + 80,
      at: at.toISOString(),
    };
  });
}

const STATUS_BADGE: Record<ActivityRow['status'], string> = {
  ok: 'bg-success/15 text-success ring-1 ring-inset ring-success/30',
  warn: 'bg-warning/15 text-warning ring-1 ring-inset ring-warning/40',
  fail: 'bg-destructive/15 text-destructive ring-1 ring-inset ring-destructive/30',
};

export function ActivityTable() {
  const t = useTranslations('pages.overview.activity');
  const locale = useLocale();
  const data = useMemo(() => generateRows(25), []);
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
    [locale],
  );
  const eventLabel = useMemo<Record<ActivityRow['event'], string>>(
    () => ({
      deploy: t('eventDeploy'),
      alert: t('eventAlert'),
      audit: t('eventAudit'),
    }),
    [t],
  );
  const columns = useMemo<ColumnDef<ActivityRow>[]>(
    () => [
      {
        accessorKey: 'site',
        header: t('colSite'),
        cell: ({ row }) => <span className="font-medium text-foreground">{row.original.site}</span>,
      },
      {
        accessorKey: 'event',
        header: t('colEvent'),
        cell: ({ row }) => eventLabel[row.original.event],
      },
      {
        accessorKey: 'status',
        header: t('colStatus'),
        cell: ({ row }) => {
          const s = row.original.status;
          return (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[s]}`}
            >
              {s}
            </span>
          );
        },
      },
      {
        accessorKey: 'durationMs',
        header: t('colDuration'),
        cell: ({ row }) => t('durationFormat', { ms: row.original.durationMs }),
      },
      {
        accessorKey: 'at',
        header: t('colWhen'),
        cell: ({ row }) => (
          <time dateTime={row.original.at} className="tabular-nums text-muted-foreground">
            {dateFormatter.format(new Date(row.original.at))}
          </time>
        ),
      },
    ],
    [t, eventLabel, dateFormatter],
  );

  return <DataTable data={data} columns={columns} pageSize={8} />;
}
