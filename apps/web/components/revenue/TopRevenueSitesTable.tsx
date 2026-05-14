'use client';

import { type ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';
import { useMemo } from 'react';

import { DataTable } from '@/components/common/data-table';

export type TopRevenueRow = {
  siteId: string;
  slug: string;
  name: string;
  adRevenue: number;
  affiliateRevenue: number;
  total: number;
};

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

/**
 * Top-N revenue sites table. Site name links to `/sites/[id]/revenue` so
 * an operator can drill straight from the global view; columns mirror
 * the API payload (`adRevenue`, `affiliateRevenue`, `total`).
 */
export function TopRevenueSitesTable({ rows }: { rows: TopRevenueRow[] }) {
  const columns = useMemo<ColumnDef<TopRevenueRow>[]>(() => {
    return [
      {
        accessorKey: 'name',
        header: 'Site',
        cell: ({ row }) => {
          const r = row.original;
          return (
            <div className="flex flex-col gap-0.5">
              <Link
                href={`/sites/${r.siteId}/revenue`}
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
        accessorKey: 'adRevenue',
        header: 'AdSense',
        cell: ({ row }) => (
          <span className={cellTone(row.original.adRevenue)}>
            {usd.format(row.original.adRevenue)}
          </span>
        ),
      },
      {
        accessorKey: 'affiliateRevenue',
        header: 'Affiliate',
        cell: ({ row }) => (
          <span className={cellTone(row.original.affiliateRevenue)}>
            {usd.format(row.original.affiliateRevenue)}
          </span>
        ),
      },
      {
        accessorKey: 'total',
        header: 'Total',
        cell: ({ row }) => (
          <span className="font-medium tabular-nums text-foreground">
            {usd.format(row.original.total)}
          </span>
        ),
      },
    ];
  }, []);

  return (
    <section aria-label="Top revenue sites" className="space-y-2">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Top sites by revenue</h2>
        <span className="text-xs text-muted-foreground">{rows.length} sites</span>
      </header>
      <DataTable
        data={rows}
        columns={columns}
        pageSize={10}
        emptyMessage="No revenue recorded for any site in this window."
      />
    </section>
  );
}

function cellTone(amount: number): string {
  return amount > 0 ? 'tabular-nums' : 'tabular-nums text-muted-foreground';
}
