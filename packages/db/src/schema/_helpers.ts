import { sql } from 'drizzle-orm';
import { timestamp } from 'drizzle-orm/pg-core';

/**
 * Shared timestamp columns. `updated_at` is maintained automatically by the
 * `set_updated_at()` BEFORE UPDATE trigger created in the initial migration.
 *
 * Tables that do not need `updated_at` (audit logs, append-only tables) should
 * use `createdAt()` directly.
 */
export const createdAt = (name = 'created_at') =>
  timestamp(name, { withTimezone: true, mode: 'date' }).notNull().defaultNow();

export const updatedAt = (name = 'updated_at') =>
  timestamp(name, { withTimezone: true, mode: 'date' })
    .notNull()
    .default(sql`now()`);
