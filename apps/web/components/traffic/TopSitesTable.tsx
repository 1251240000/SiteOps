'use client';

import { type ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { DataTable } from '@/components/common/data-table';

export type TopSiteRow = {
  siteId: string;
  slug: string;
  name: string;
  pv: number;
  uv: number;
  sessions: number;
};

const intFmt = new Intl.NumberFormat('en-US');

/**
 * Top-N sites table built on the existing `DataTable` (TanStack v8). Site
 * name links into `/sites/[id]/traffic` so the operator can drill in from
 * the global view in one click.
 */
export function TopSitesTable({
  rows,
  metric,
}: {
  rows: TopSiteRow[];
  metric: 'pv' | 'uv' | 'sessions';
}) {
  const t = useTranslations('pages.traffic.topSites');
  const tMetric = useTranslations('pages.traffic.chart.metric');
  const columns = useMemo<ColumnDef<TopSiteRow>[]>(() => {
    return [
      {
        accessorKey: 'name',
        header: t('colSite'),
        cell: ({ row }) => {
          const r = row.original;
          return (
            <div className="flex flex-col gap-0.5">
              <Link
                href={`/sites/${r.siteId}/traffic`}
                className="font-medium text-foreground hover:underline"
              >
                {r.name}
              </Link>
              <span className="font-mono text-xs text-muted-foreground">{r.slug}</span>
            </div>
          );
        },
      },
      {
        accessorKey: 'pv',
        header: t('colPv'),
        cell: ({ row }) => (
          <span
            className={row.original.pv > 0 ? 'tabular-nums' : 'tabular-nums text-muted-foreground'}
          >
            {intFmt.format(row.original.pv)}
          </span>
        ),
      },
      {
        accessorKey: 'uv',
        header: t('colUv'),
        cell: ({ row }) => (
          <span
            className={row.original.uv > 0 ? 'tabular-nums' : 'tabular-nums text-muted-foreground'}
          >
            {intFmt.format(row.original.uv)}
          </span>
        ),
      },
      {
        accessorKey: 'sessions',
        header: t('colSessions'),
        cell: ({ row }) => (
          <span
            className={
              row.original.sessions > 0 ? 'tabular-nums' : 'tabular-nums text-muted-foreground'
            }
          >
            {intFmt.format(row.original.sessions)}
          </span>
        ),
      },
    ];
  }, [t]);

  return (
    <section aria-label={t('ariaLabel')} className="space-y-2">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
        <span className="text-xs text-muted-foreground">
          {t('sortedBy', { metric: tMetric(metric) })}
        </span>
      </header>
      <DataTable data={rows} columns={columns} pageSize={10} emptyMessage={t('empty')} />
    </section>
  );
}
