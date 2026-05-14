'use client';

import { type ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';
import { useMemo } from 'react';

import { DataTable } from '@/components/common/data-table';
import { cn } from '@/lib/utils';

import type { LowEfficiencyFlag } from './LowEfficiencyBanner';

export type RoiRow = {
  siteId: string;
  slug: string;
  name: string;
  status: 'active' | 'paused' | 'archived';
  pv: number;
  revenue: number;
  cost: number;
  profit: number;
  roi: number | null;
  rpm: number | null;
  flags: LowEfficiencyFlag[];
};

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

const pct = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 1,
});

const intFmt = new Intl.NumberFormat('en-US');

const FLAG_LABEL: Record<LowEfficiencyFlag, string> = {
  negative_roi: 'ROI<0',
  low_rpm: 'low RPM',
  declining_revenue: 'declining',
};

/**
 * Global ROI ranking table. Visual conventions:
 *   - Negative ROI rows get a faint red background (`destructive`).
 *   - High-ROI rows (`roi >= 2`) get a green dot to celebrate.
 *   - Flag chips are listed in the right-most column for at-a-glance
 *     "this site needs work" signal.
 */
export function RoiTable({ rows }: { rows: RoiRow[] }) {
  const columns = useMemo<ColumnDef<RoiRow>[]>(() => {
    return [
      {
        accessorKey: 'name',
        header: 'Site',
        cell: ({ row }) => {
          const r = row.original;
          const showWin = r.roi !== null && r.roi >= 2;
          return (
            <div className="flex items-start gap-2">
              <span
                className={cn(
                  'mt-1.5 inline-block size-2 shrink-0 rounded-full',
                  showWin ? 'bg-success' : 'bg-transparent',
                )}
                aria-hidden
              />
              <div className="flex flex-col gap-0.5">
                <Link
                  href={`/sites/${r.siteId}/revenue`}
                  className="font-medium text-foreground hover:underline"
                >
                  {r.name}
                </Link>
                <span className="font-mono text-xs text-muted-foreground">
                  {r.slug}
                  {r.status !== 'active' ? (
                    <span className="ml-1 rounded bg-muted px-1 py-0.5 text-[10px] uppercase">
                      {r.status}
                    </span>
                  ) : null}
                </span>
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: 'pv',
        header: 'PV',
        cell: ({ row }) => (
          <span className="tabular-nums text-muted-foreground">
            {intFmt.format(row.original.pv)}
          </span>
        ),
      },
      {
        accessorKey: 'revenue',
        header: 'Revenue',
        cell: ({ row }) => <span className="tabular-nums">{usd.format(row.original.revenue)}</span>,
      },
      {
        accessorKey: 'cost',
        header: 'Cost',
        cell: ({ row }) => <span className="tabular-nums">{usd.format(row.original.cost)}</span>,
      },
      {
        accessorKey: 'profit',
        header: 'Profit',
        cell: ({ row }) => (
          <span
            className={cn(
              'tabular-nums font-medium',
              row.original.profit < 0 ? 'text-destructive' : 'text-foreground',
            )}
          >
            {usd.format(row.original.profit)}
          </span>
        ),
      },
      {
        accessorKey: 'roi',
        header: 'ROI',
        cell: ({ row }) => {
          const roi = row.original.roi;
          if (roi === null) {
            return <span className="text-muted-foreground">N/A</span>;
          }
          return (
            <span
              className={cn(
                'tabular-nums font-medium',
                roi < 0 ? 'text-destructive' : 'text-foreground',
              )}
            >
              {pct.format(roi)}
            </span>
          );
        },
      },
      {
        accessorKey: 'rpm',
        header: 'RPM',
        cell: ({ row }) => {
          const rpm = row.original.rpm;
          if (rpm === null) return <span className="text-muted-foreground">—</span>;
          return <span className="tabular-nums">{usd.format(rpm)}</span>;
        },
      },
      {
        accessorKey: 'flags',
        header: 'Flags',
        cell: ({ row }) => {
          const flags = row.original.flags;
          if (flags.length === 0) return <span className="text-muted-foreground">—</span>;
          return (
            <div className="flex flex-wrap gap-1">
              {flags.map((f) => (
                <span
                  key={f}
                  className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-warning"
                >
                  {FLAG_LABEL[f]}
                </span>
              ))}
            </div>
          );
        },
      },
    ];
  }, []);

  return (
    <DataTable
      data={rows}
      columns={columns}
      pageSize={50}
      emptyMessage="No sites yet — create one and add cost / revenue data to see ROI."
      rowClassName={(row) => (row.profit < 0 ? 'bg-destructive/5' : undefined)}
    />
  );
}
