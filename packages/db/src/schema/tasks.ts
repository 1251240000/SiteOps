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

import { createdAt, updatedAt } from './_helpers.js';
import { sites } from './sites.js';

/**
 * Task queue. External Agents pull-claim rows via REST + bearer token; the
 * dashboard enqueues / monitors them. Atomic claim is implemented in
 * `taskRepo.claimNext` via `SELECT ... FOR UPDATE SKIP LOCKED`.
 *
 * The state machine and column semantics are documented in
 * `tasks/T25-task-queue-api.md`. Brief column notes:
 *
 *   - `kind`              free-text (validated client-side); see `KNOWN_TASK_KINDS`.
 *   - `priority`          higher value claimed first, ties broken by `available_at`.
 *   - `available_at`      earliest time the row may be claimed (now() by default).
 *   - `dedupe_key`        optional idempotency key; partial unique on
 *                         `(dedupe_key)` while status ∈ {queued, claimed}.
 *   - `claim_token`       opaque uuid issued at claim; required to heartbeat /
 *                         complete / fail. Cleared on terminal transition.
 *   - `claim_lease_until` deadline by which the agent must heartbeat or finish.
 *                         A worker housekeeping pass requeues / expires past-due rows.
 *   - `attempts`          incremented on each claim. When `attempts >= max_attempts`
 *                         the next failure is terminal regardless of `retry`.
 *   - `last_error`        free-text, populated on `fail` (capped to 2000 by Zod).
 */
export const TASK_STATUS = [
  'queued',
  'claimed',
  'succeeded',
  'failed',
  'cancelled',
  'expired',
] as const;
export type TaskStatus = (typeof TASK_STATUS)[number];

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(),
    siteId: uuid('site_id').references(() => sites.id, { onDelete: 'set null' }),
    priority: integer('priority').notNull().default(0),
    payload: jsonb('payload')
      .notNull()
      .default(sql`'{}'::jsonb`)
      .$type<Record<string, unknown>>(),
    status: text('status').notNull().default('queued').$type<TaskStatus>(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    dedupeKey: text('dedupe_key'),
    availableAt: timestamp('available_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    claimToken: uuid('claim_token'),
    claimedBy: uuid('claimed_by'),
    claimedAt: timestamp('claimed_at', { withTimezone: true, mode: 'date' }),
    claimLeaseUntil: timestamp('claim_lease_until', { withTimezone: true, mode: 'date' }),
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
    lastError: text('last_error'),
    result: jsonb('result').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    /** Hot path: claimNext picks rows by (status='queued', available_at<=now())
     *  ordered by priority DESC, available_at ASC. */
    index('tasks_claim_idx').on(t.status, t.availableAt, t.priority),
    /** Dashboard list filters. */
    index('tasks_kind_idx').on(t.kind),
    index('tasks_site_idx').on(t.siteId),
    index('tasks_status_idx').on(t.status),
    /** Housekeeping scan: find claimed rows whose lease has expired. */
    index('tasks_lease_idx').on(t.claimLeaseUntil),
    /** Idempotency: while a row is in flight (queued|claimed) the dedupe_key
     *  is unique. Terminal rows release the slot so the same key can re-enqueue
     *  after the previous instance settled. */
    uniqueIndex('tasks_dedupe_active_uk')
      .on(t.dedupeKey)
      .where(sql`${t.dedupeKey} IS NOT NULL AND ${t.status} IN ('queued','claimed')`),
    check(
      'tasks_status_check',
      sql`${t.status} IN ('queued','claimed','succeeded','failed','cancelled','expired')`,
    ),
    check('tasks_priority_check', sql`${t.priority} BETWEEN -100 AND 100`),
    check('tasks_max_attempts_check', sql`${t.maxAttempts} BETWEEN 1 AND 10`),
    check('tasks_attempts_nonneg_check', sql`${t.attempts} >= 0`),
  ],
);

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
