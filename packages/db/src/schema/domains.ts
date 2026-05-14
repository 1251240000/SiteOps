import {
  boolean,
  date,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { createdAt } from './_helpers.js';
import { sites } from './sites.js';

export const domains = pgTable(
  'domains',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id').references(() => sites.id),
    domain: text('domain').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    registrar: text('registrar'),
    registeredAt: date('registered_at', { mode: 'string' }),
    expiresAt: date('expires_at', { mode: 'string' }),
    autoRenew: boolean('auto_renew'),
    dnsProvider: text('dns_provider'),
    sslIssuer: text('ssl_issuer'),
    sslExpiresAt: timestamp('ssl_expires_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('domains_domain_uk').on(t.domain),
    index('domains_site_id_idx').on(t.siteId),
    index('domains_expires_at_idx').on(t.expiresAt),
    index('domains_ssl_expires_at_idx').on(t.sslExpiresAt),
  ],
);

export type Domain = typeof domains.$inferSelect;
export type NewDomain = typeof domains.$inferInsert;
