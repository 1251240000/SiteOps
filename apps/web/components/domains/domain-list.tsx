'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { parseAsInteger, parseAsString, useQueryState } from 'nuqs';
import { useMemo } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ExpiryCell } from '@/components/domains/expiry-cell';
import { api, type ApiError, type ApiSuccess } from '@/lib/api-client';
import { domainsKeys, type DomainView, type DomainsListMeta } from '@/lib/queries/domains';

const PAGE_SIZE = 50;

const SORTABLE: Record<string, { asc: 'expires_at' | 'domain'; desc: '-expires_at' | '-domain' }> =
  {
    expires: { asc: 'expires_at', desc: '-expires_at' },
    domain: { asc: 'domain', desc: '-domain' },
  };

export function DomainList() {
  const t = useTranslations('pages.domains.list');
  const tCommon = useTranslations('common');
  const [q] = useQueryState('q', parseAsString.withDefault(''));
  const [expiringWithinDays] = useQueryState('expiringWithinDays', parseAsString.withDefault(''));
  const [sort, setSort] = useQueryState('sort', parseAsString.withDefault('expires_at'));
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));

  const query = useMemo(() => {
    const out: Record<string, string | number | boolean> = {
      page,
      limit: PAGE_SIZE,
      sort,
    };
    if (q) out['q'] = q;
    if (expiringWithinDays) out['expiringWithinDays'] = expiringWithinDays;
    return out;
  }, [q, expiringWithinDays, sort, page]);

  const {
    data: envelope,
    error,
    isLoading,
  } = useQuery<ApiSuccess<DomainView[]>, ApiError>({
    queryKey: domainsKeys.list(query),
    queryFn: () => api.get<DomainView[]>('/domains', { query }),
  });
  const items = envelope?.data ?? [];
  const meta = envelope?.meta as DomainsListMeta | undefined;

  function onSortClick(col: keyof typeof SORTABLE) {
    const map = SORTABLE[col]!;
    if (sort === map.desc) void setSort(map.asc);
    else void setSort(map.desc);
    void setPage(null);
  }

  function renderSortIcon(col: string) {
    const map = SORTABLE[col];
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
              <th scope="col" className="px-4 py-3 text-left font-medium">
                <button
                  type="button"
                  onClick={() => onSortClick('domain')}
                  className="inline-flex items-center gap-1 hover:text-foreground"
                  aria-label={t('sortByDomain')}
                >
                  {t('colDomain')} {renderSortIcon('domain')}
                </button>
              </th>
              <th scope="col" className="px-4 py-3 text-left font-medium">
                {t('colSite')}
              </th>
              <th scope="col" className="px-4 py-3 text-left font-medium">
                {t('colRegistrarDns')}
              </th>
              <th scope="col" className="px-4 py-3 text-left font-medium">
                <button
                  type="button"
                  onClick={() => onSortClick('expires')}
                  className="inline-flex items-center gap-1 hover:text-foreground"
                  aria-label={t('sortByExpires')}
                >
                  {t('colExpires')} {renderSortIcon('expires')}
                </button>
              </th>
              <th scope="col" className="px-4 py-3 text-left font-medium">
                {t('colSsl')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-card">
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={`sk-${i}`}>
                  {Array.from({ length: 5 }).map((__, j) => (
                    <td key={j} className="px-4 py-3">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  ))}
                </tr>
              ))
            ) : error ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-destructive">
                  {error.message || t('loadFailed')}
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                  {t('empty')}
                </td>
              </tr>
            ) : (
              items.map((d) => (
                <tr
                  key={d.id}
                  className={
                    typeof d.daysUntilDomainExpiry === 'number' && d.daysUntilDomainExpiry < 0
                      ? 'bg-destructive/5 hover:bg-destructive/10'
                      : typeof d.daysUntilDomainExpiry === 'number' && d.daysUntilDomainExpiry <= 30
                        ? 'bg-warning/5 hover:bg-warning/10'
                        : 'hover:bg-muted/40'
                  }
                >
                  <td className="px-4 py-3 align-middle">
                    <span className="flex items-center gap-2 font-medium text-foreground">
                      {d.domain}
                      {d.isPrimary ? <Badge variant="success">{t('primaryBadge')}</Badge> : null}
                    </span>
                  </td>
                  <td className="px-4 py-3 align-middle">
                    {d.siteId ? (
                      <Link
                        href={`/sites/${d.siteId}`}
                        className="font-mono text-xs text-muted-foreground hover:text-foreground"
                      >
                        {d.siteId.slice(0, 8)}…
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 align-middle text-muted-foreground">
                    <span className="text-foreground">{d.registrar ?? '—'}</span>
                    <span className="ml-1">/ {d.dnsProvider ?? '—'}</span>
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <ExpiryCell date={d.expiresAt} daysUntil={d.daysUntilDomainExpiry} />
                  </td>
                  <td className="px-4 py-3 align-middle text-muted-foreground">
                    {d.sslExpiresAt ? (
                      <ExpiryCell
                        date={String(d.sslExpiresAt).slice(0, 10)}
                        daysUntil={d.daysUntilSslExpiry}
                      />
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
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
