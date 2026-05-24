'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface LoadMoreFooterProps {
  /** How many rows are currently rendered in the list (across all pages). */
  loadedCount: number;
  /** Whether the server has more rows beyond what we've fetched. */
  hasMore: boolean;
  /** Are we currently fetching the *next* page? */
  isFetchingMore: boolean;
  /** Click handler — wired straight to `fetchNextPage()`. */
  onLoadMore: () => void;
  className?: string;
}

/**
 * Footer shown beneath cursor-paginated lists (T36). Replaces the old
 * prev/next pager — keyset pagination has no notion of "page 3 of 12" so
 * we show the running row count instead, and surface a single "Load more"
 * button that maps directly to `useInfiniteQuery#fetchNextPage()`.
 *
 * Renders nothing when `loadedCount === 0` so empty-state messaging owns
 * the visual real estate.
 */
export function LoadMoreFooter({
  loadedCount,
  hasMore,
  isFetchingMore,
  onLoadMore,
  className,
}: LoadMoreFooterProps) {
  const t = useTranslations('common.pagination');
  if (loadedCount === 0) return null;
  return (
    <div
      className={cn(
        'flex flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <span aria-live="polite">{t('showingCount', { count: loadedCount })}</span>
      {hasMore ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onLoadMore}
          disabled={isFetchingMore}
        >
          {isFetchingMore ? (
            <>
              <Loader2 className="mr-2 size-3 animate-spin" aria-hidden />
              {t('loadingMore')}
            </>
          ) : (
            t('loadMore')
          )}
        </Button>
      ) : (
        <span>{t('endOfResults')}</span>
      )}
    </div>
  );
}
