import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { createdAt, updatedAt } from './_helpers.js';

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

export type SiteTechStack = {
  framework?: string;
  hosting?: string;
  db?: string;
};

export const sites = pgTable(
  'sites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    primaryUrl: text('primary_url').notNull(),
    siteType: text('site_type').notNull().$type<SiteType>(),
    status: text('status').notNull().default('active').$type<SiteStatus>(),
    targetCountry: text('target_country'),
    targetLanguage: text('target_language'),
    techStack: jsonb('tech_stack').$type<SiteTechStack>(),
    repoUrl: text('repo_url'),
    repoProvider: text('repo_provider').$type<RepoProvider>(),
    cfAccountId: text('cf_account_id'),
    cfPagesProject: text('cf_pages_project'),
    analyticsProvider: text('analytics_provider').$type<AnalyticsProvider>(),
    analyticsId: text('analytics_id'),
    publicAnalyticsKey: text('public_analytics_key')
      .notNull()
      .default(sql`'site_pk_' || encode(gen_random_bytes(18), 'hex')`),
    searchConsoleProperty: text('search_console_property'),
    adsensePublisherId: text('adsense_publisher_id'),
    adsenseStatus: text('adsense_status').$type<AdsenseStatus>(),
    healthScore: smallint('health_score').notNull().default(100),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('sites_slug_uk').on(t.slug),
    uniqueIndex('sites_public_analytics_key_uk').on(t.publicAnalyticsKey),
    index('sites_site_type_idx').on(t.siteType),
    index('sites_status_idx').on(t.status),
    index('sites_target_country_idx').on(t.targetCountry),
    index('sites_tags_gin_idx').using('gin', t.tags),
    check(
      'sites_site_type_check',
      sql`${t.siteType} IN ('directory','tool','content','forum','landing')`,
    ),
    check('sites_status_check', sql`${t.status} IN ('active','paused','archived')`),
    check(
      'sites_repo_provider_check',
      sql`${t.repoProvider} IS NULL OR ${t.repoProvider} IN ('github','gitlab','gitee')`,
    ),
    check(
      'sites_analytics_provider_check',
      sql`${t.analyticsProvider} IS NULL OR ${t.analyticsProvider} IN ('ga4','plausible','none')`,
    ),
    check(
      'sites_adsense_status_check',
      sql`${t.adsenseStatus} IS NULL OR ${t.adsenseStatus} IN ('pending','approved','rejected','not_applied')`,
    ),
    check('sites_health_score_range', sql`${t.healthScore} >= 0 AND ${t.healthScore} <= 100`),
  ],
);

export type Site = typeof sites.$inferSelect;
export type NewSite = typeof sites.$inferInsert;
