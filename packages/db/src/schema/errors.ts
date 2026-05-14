import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { sites } from './sites.js';

export const ERROR_SOURCES = ['js', 'build', 'api', 'worker'] as const;
export type ErrorSource = (typeof ERROR_SOURCES)[number];

export const ERROR_LEVELS = ['error', 'warning'] as const;
export type ErrorLevel = (typeof ERROR_LEVELS)[number];

export const errors = pgTable(
  'errors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id),
    source: text('source').notNull().$type<ErrorSource>(),
    level: text('level').notNull().$type<ErrorLevel>(),
    fingerprint: text('fingerprint').notNull(),
    message: text('message'),
    stack: text('stack'),
    count: integer('count').notNull().default(1),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'date' }),
    meta: jsonb('meta').$type<Record<string, unknown>>(),
  },
  (t) => [
    uniqueIndex('errors_site_fingerprint_uk').on(t.siteId, t.fingerprint),
    index('errors_site_last_seen_idx').on(t.siteId, t.lastSeenAt.desc()),
    check('errors_source_check', sql`${t.source} IN ('js','build','api','worker')`),
    check('errors_level_check', sql`${t.level} IN ('error','warning')`),
  ],
);

export type ErrorRow = typeof errors.$inferSelect;
export type NewErrorRow = typeof errors.$inferInsert;
