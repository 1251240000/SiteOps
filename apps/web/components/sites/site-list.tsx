'use client';

import { useQuery } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { parseAsInteger, parseAsString, useQueryState } from 'nuqs';
import { useMemo } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api, type ApiError, type ApiSuccess } from '@/lib/api-client';
import { sitesKeys, type Site, type SitesListMeta } from '@/lib/queries/sites';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 20;

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'muted'> = {
  active: 'success',
  paused: 'warning',
  archived: 'muted',
};

const SORTABLE_COLS: Record<
  string,
  { asc: 'created_at' | 'health_score' | 'name'; desc: '-created_at' | '-health_score' | '-name' }
> = {
  name: { asc: 'name', desc: '-name' },
  createdAt: { asc: 'created_at', desc: '-created_at' },
  healthScore: { asc: 'health_score', desc: '-health_score' },
};

export function SiteList() {
  const router = useRouter();
  const t = useTranslations('pages.sites.list');
  const tCommon = useTranslations('common');
  const tEnumStatus = useTranslations('enums.siteStatus');
  const tEnumType = useTranslations('enums.siteType');
  const [q] = useQueryState('q', parseAsString.withDefault(''));
  const [siteType] = useQueryState('siteType', parseAsString.withDefault(''));
  const [status] = useQueryState('status', parseAsString.withDefault(''));
  const [archived] = useQueryState('archived', parseAsString.withDefault(''));
  const [sort, setSort] = useQueryState('sort', parseAsString.withDefault('-created_at'));
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));

  const query = useMemo(() => {
    const out: Record<string, string | number | boolean> = {
      page,
      limit: PAGE_SIZE,
      sort,
    };
    if (q) out['q'] = q;
    if (siteType) out['siteType'] = siteType;
    if (status) out['status'] = status;
    if (archived === 'true' || archived === '1') out['archived'] = true;
    return out;
  }, [q, siteType, status, archived, sort, page]);

  // `useApi` would unwrap to just the array; we need the meta envelope to
  // drive pagination, so we call `useQuery` directly with the api-client.
  const {
    data: envelope,
    error,
    isLoading,
  } = useQuery<ApiSuccess<Site[]>, ApiError>({
    queryKey: sitesKeys.list(query),
    queryFn: () => api.get<Site[]>('/sites', { query }),
  });
  const items = envelope?.data ?? [];
  const meta = envelope?.meta as SitesListMeta | undefined;

  const columns: ColumnDef<Site>[] = useMemo(
    () => [
      {
        id: 'name',
        accessorFn: (s) => s.name,
        header: t('colName'),
        cell: ({ row }) => (
          <div className="flex flex-col">
            <Link
              href={`/sites/${row.original.id}`}
              className="font-medium text-foreground hover:underline"
            >
              {row.original.name}
            </Link>
            <span className="text-xs text-muted-foreground">{row.original.slug}</span>
          </div>
        ),
      },
      {
        id: 'primary',
        accessorFn: (s) => s.primaryUrl,
        header: t('colPrimary'),
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">{row.original.primaryUrl}</span>
        ),
      },
      {
        id: 'type',
        accessorFn: (s) => s.siteType,
        header: t('colType'),
        cell: ({ row }) => <Badge variant="outline">{tEnumType(row.original.siteType)}</Badge>,
      },
      {
        id: 'status',
        accessorFn: (s) => s.status,
        header: t('colStatus'),
        cell: ({ row }) => (
          <Badge variant={STATUS_VARIANT[row.original.status] ?? 'outline'}>
            {tEnumStatus(row.original.status)}
          </Badge>
        ),
      },
      {
        id: 'healthScore',
        accessorFn: (s) => s.healthScore,
        header: t('colHealth'),
        cell: ({ row }) => `${row.original.healthScore}`,
      },
      {
        id: 'createdAt',
        accessorFn: (s) => s.createdAt,
        header: t('colCreated'),
        cell: ({ row }) => (
          <time
            dateTime={new Date(row.original.createdAt).toISOString()}
            className="tabular-nums text-muted-foreground"
          >
            {new Date(row.original.createdAt).toLocaleDateString()}
          </time>
        ),
      },
    ],
    [t, tEnumStatus, tEnumType],
  );

  function onSortClick(colId: keyof typeof SORTABLE_COLS) {
    const map = SORTABLE_COLS[colId]!;
    if (sort === map.desc) void setSort(map.asc);
    else void setSort(map.desc);
    void setPage(null);
  }

  function renderSortIcon(colId: string) {
    const map = SORTABLE_COLS[colId as keyof typeof SORTABLE_COLS];
    if (!map) return null;
    if (sort === map.asc) return <ArrowUp className="size-3" aria-hidden />;
    if (sort === map.desc) return <ArrowDown className="size-3" aria-hidden />;
    return <ArrowUpDown className="size-3" aria-hidden />;
  }

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              {columns.map((col) => {
                const id = col.id!;
                const sortable = id in SORTABLE_COLS;
                return (
                  <th key={id} scope="col" className="px-4 py-3 text-left font-medium">
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => onSortClick(id as keyof typeof SORTABLE_COLS)}
                        className="inline-flex items-center gap-1 hover:text-foreground"
                        aria-label={t('sortByAriaLabel', { column: col.header as string })}
                      >
                        {col.header as string}
                        {renderSortIcon(id)}
                      </button>
                    ) : (
                      (col.header as string)
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-card">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={`sk-${i}`}>
                  {columns.map((col) => (
                    <td key={`${col.id}-${i}`} className="px-4 py-3">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  ))}
                </tr>
              ))
            ) : error ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-destructive">
                  {error.message || t('loadFailed')}
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-10 text-center text-muted-foreground"
                >
                  {t('empty')}
                </td>
              </tr>
            ) : (
              items.map((row) => (
                <tr
                  key={row.id}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={(e) => {
                    // Don't hijack clicks on inner links / buttons.
                    const tag = (e.target as HTMLElement).tagName.toLowerCase();
                    if (tag === 'a' || tag === 'button') return;
                    router.push(`/sites/${row.id}`);
                  }}
                >
                  {columns.map((col) => {
                    type Ctx = {
                      row: { original: Site };
                      column: { id: string };
                      getValue: () => unknown;
                    };
                    const ctx: Ctx = {
                      row: { original: row },
                      column: { id: col.id! },
                      getValue: () => undefined,
                    };
                    const cell =
                      typeof col.cell === 'function'
                        ? (col.cell as (c: Ctx) => unknown)(ctx)
                        : (col.cell ?? null);
                    return (
                      <td key={col.id} className="px-4 py-3 align-middle">
                        {cell as React.ReactNode}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div
        className={cn(
          'flex flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between',
        )}
      >
        <span>
          {meta
            ? tCommon('pagination.showing', {
                from: items.length ? (meta.page - 1) * meta.limit + 1 : 0,
                to: (meta.page - 1) * meta.limit + items.length,
                total: meta.total,
              })
            : '\u00A0'}
        </span>
        <div className="flex items-center gap-2">
          <span>
            {tCommon.rich('pagination.page', {
              strong: (chunks) => <strong>{chunks}</strong>,
              page: meta?.page ?? page,
              total: meta?.totalPages ?? 1,
            })}
          </span>
          <Button
            size="icon"
            variant="outline"
            disabled={!meta || meta.page <= 1}
            onClick={() => setPage(Math.max(1, (meta?.page ?? page) - 1))}
            aria-label={tCommon('pagination.previous')}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="outline"
            disabled={!meta || meta.page >= (meta?.totalPages ?? 1)}
            onClick={() => setPage((meta?.page ?? page) + 1)}
            aria-label={tCommon('pagination.next')}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
