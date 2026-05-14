/**
 * Canonical site-related enums. Mirrored in `@siteops/db` schema CHECK
 * constraints; drift is guarded by `packages/db/src/schema/__tests__/constants-drift.test.ts`.
 */

export const SITE_TYPES = ['directory', 'tool', 'content', 'forum', 'landing'] as const;
export type SiteType = (typeof SITE_TYPES)[number];

export const SITE_STATUS = ['active', 'paused', 'archived'] as const;
export type SiteStatus = (typeof SITE_STATUS)[number];

export const REPO_PROVIDERS = ['github', 'gitlab', 'gitee'] as const;
export type RepoProvider = (typeof REPO_PROVIDERS)[number];

export const ANALYTICS_PROVIDERS = ['ga4', 'plausible', 'none'] as const;
export type AnalyticsProvider = (typeof ANALYTICS_PROVIDERS)[number];

export const ADSENSE_STATUS = ['pending', 'approved', 'rejected', 'not_applied'] as const;
export type AdsenseStatus = (typeof ADSENSE_STATUS)[number];
