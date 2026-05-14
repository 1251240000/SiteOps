import { type Deployment } from '@siteops/db';

export type { Deployment };

export const deploymentsKeys = {
  all: ['deployments'] as const,
  lists: () => [...deploymentsKeys.all, 'list'] as const,
  list: (query: Record<string, unknown>) => [...deploymentsKeys.lists(), query] as const,
  details: () => [...deploymentsKeys.all, 'detail'] as const,
  detail: (id: string) => [...deploymentsKeys.details(), id] as const,
  forSite: (siteId: string) => [...deploymentsKeys.all, 'site', siteId] as const,
};

export type DeploymentsListMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};
