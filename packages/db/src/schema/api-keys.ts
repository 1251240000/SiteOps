import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { createdAt } from './_helpers.js';

/**
 * External agent API keys. `key_hash` stores `bcrypt(plaintext)`; the plaintext
 * is shown to the user once at issue time and never persisted.
 *
 * `rate_limit_per_min` is an optional per-key override (T38). NULL means
 * "use the global default" (`API_KEY_RATE_LIMIT_PER_MIN`, currently 600/min).
 * The CHECK constraint blocks `0` so an admin can't accidentally lock a key
 * out via this field — they should set `revoked_at` instead.
 */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    keyHash: text('key_hash').notNull(),
    keyPrefix: text('key_prefix').notNull(),
    scopes: text('scopes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    rateLimitPerMin: integer('rate_limit_per_min'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('api_keys_key_hash_uk').on(t.keyHash),
    index('api_keys_key_prefix_idx').on(t.keyPrefix),
    check(
      'api_keys_rate_limit_per_min_check',
      sql`${t.rateLimitPerMin} IS NULL OR ${t.rateLimitPerMin} > 0`,
    ),
  ],
);

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
