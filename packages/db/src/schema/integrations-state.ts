/**
 * Per-(site, provider) integration sync state.
 *
 * Tracks the last successful sync time, an opaque cursor (used by providers
 * that expose paginated APIs — currently CF + GH), and the last error message
 * so the dashboard can surface failing integrations without parsing logs.
 *
 * `siteId` may be NULL for global integrations (e.g. AdSense at the publisher
 * level when no site mapping has been established yet). The partial unique
 * index below treats the (NULL site_id, provider) pair as a sentinel "global"
 * row per provider.
 */
import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { sites } from './sites.js';

export const INTEGRATION_PROVIDERS = [
  'cloudflare',
  'github',
  'ga4',
  'plausible',
  'gsc',
  'adsense',
] as const;
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

export const integrationsState = pgTable(
  'integrations_state',
  {
    siteId: uuid('site_id').references(() => sites.id),
    provider: text('provider').notNull().$type<IntegrationProvider>(),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true, mode: 'date' }),
    lastCursor: text('last_cursor'),
    lastError: text('last_error'),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    // Per-site uniqueness. `(NULL, provider)` rows are deduped via a separate
    // partial unique below because PG treats two NULLs as distinct in a plain
    // unique constraint.
    uniqueIndex('integrations_state_site_provider_uk')
      .on(t.siteId, t.provider)
      .where(sql`${t.siteId} IS NOT NULL`),
    uniqueIndex('integrations_state_global_provider_uk')
      .on(t.provider)
      .where(sql`${t.siteId} IS NULL`),
    index('integrations_state_provider_idx').on(t.provider),
  ],
);

export type IntegrationsStateRow = typeof integrationsState.$inferSelect;
export type NewIntegrationsStateRow = typeof integrationsState.$inferInsert;
