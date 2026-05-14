/**
 * Centralised query-key factory + typed helpers for the `sites` resource.
 *
 * Keeping every cache key here means cache invalidation lives in one place:
 * after a mutation, components call `queryClient.invalidateQueries({ queryKey:
 * sitesKeys.lists() })` to refresh every list page regardless of filter args.
 */
import { type Site } from '@siteops/db';

export type { Site };

export const sitesKeys = {
  all: ['sites'] as const,
  lists: () => [...sitesKeys.all, 'list'] as const,
  list: (query: Record<string, unknown>) => [...sitesKeys.lists(), query] as const,
  details: () => [...sitesKeys.all, 'detail'] as const,
  detail: (id: string) => [...sitesKeys.details(), id] as const,
};

export type SitesListMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};
