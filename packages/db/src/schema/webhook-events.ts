import { sql } from 'drizzle-orm';
import {
  boolean,
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

import { createdAt } from './_helpers.js';
import { sites } from './sites.js';

/**
 * Inbound webhook events from CF Notification / GitHub. Each delivery lands
 * here (signature-failed deliveries included, for audit) before being
 * dispatched into `deploymentService`.
 *
 * State machine is "tristate" rather than enum:
 *   - `processed_at` NULL  + `error` NULL  → ingested, not yet dispatched
 *   - `processed_at` !NULL + `error` NULL  → dispatch succeeded
 *   - `processed_at` NULL  + `error` !NULL → dispatch failed; admin can replay
 *
 * `signature_ok=false` rows are end-state: `processed_at` and `site_id`
 * stay NULL forever (we never dispatch a forged payload).
 *
 * Idempotency is enforced by the partial unique index on
 * `(provider, delivery_id)` — when an attacker / provider re-sends the
 * same delivery, DB returns 23505 and the service short-circuits with
 * `duplicate=true`.
 */
export const WEBHOOK_PROVIDERS = ['cloudflare', 'github'] as const;
export type WebhookProvider = (typeof WEBHOOK_PROVIDERS)[number];

export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider').notNull().$type<WebhookProvider>(),
    eventType: text('event_type').notNull(),
    deliveryId: text('delivery_id').notNull(),
    signatureOk: boolean('signature_ok').notNull(),
    payload: jsonb('payload').notNull().$type<Record<string, unknown>>(),
    siteId: uuid('site_id').references(() => sites.id, { onDelete: 'set null' }),
    processedAt: timestamp('processed_at', { withTimezone: true, mode: 'date' }),
    error: text('error'),
    attempts: integer('attempts').notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [
    /** Idempotent inbound: same delivery from same provider → 23505 in service. */
    uniqueIndex('webhook_events_delivery_uk').on(t.provider, t.deliveryId),
    /** Dashboard list: most-recent-first per provider. */
    index('webhook_events_provider_created_idx').on(t.provider, t.createdAt),
    /** Housekeeping scan: find unprocessed events for the replay UI. */
    index('webhook_events_unprocessed_idx')
      .on(t.provider, t.createdAt)
      .where(sql`${t.processedAt} IS NULL`),
    check('webhook_events_provider_check', sql`${t.provider} IN ('cloudflare','github')`),
    check('webhook_events_attempts_nonneg_check', sql`${t.attempts} >= 1`),
  ],
);

export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type NewWebhookEvent = typeof webhookEvents.$inferInsert;
