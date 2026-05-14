import { type Domain } from '@siteops/db';

export type DomainView = Domain & {
  daysUntilDomainExpiry: number | null;
  daysUntilSslExpiry: number | null;
};

export const domainsKeys = {
  all: ['domains'] as const,
  lists: () => [...domainsKeys.all, 'list'] as const,
  list: (query: Record<string, unknown>) => [...domainsKeys.lists(), query] as const,
  details: () => [...domainsKeys.all, 'detail'] as const,
  detail: (id: string) => [...domainsKeys.details(), id] as const,
  forSite: (siteId: string) => [...domainsKeys.all, 'site', siteId] as const,
};

export type DomainsListMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};
