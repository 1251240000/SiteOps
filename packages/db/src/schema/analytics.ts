import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { createdAt } from './_helpers.js';
import { sites } from './sites.js';

export const ANALYTICS_EVENT_TYPES = ['pageview', 'event', 'web_vital', 'identify'] as const;
export type AnalyticsEventType = (typeof ANALYTICS_EVENT_TYPES)[number];

export const analyticsSessions = pgTable(
  'analytics_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    visitorId: text('visitor_id').notNull(),
    sessionId: text('session_id').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' }).notNull(),
    referrer: text('referrer'),
    utm: jsonb('utm').$type<Record<string, unknown>>(),
    device: jsonb('device').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('analytics_sessions_site_session_uk').on(t.siteId, t.sessionId),
    index('analytics_sessions_site_seen_idx').on(t.siteId, t.lastSeenAt),
    index('analytics_sessions_site_visitor_idx').on(t.siteId, t.visitorId),
  ],
);

export const analyticsEvents = pgTable(
  'analytics_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    sessionId: text('session_id').notNull(),
    visitorId: text('visitor_id').notNull(),
    type: text('type').notNull().$type<AnalyticsEventType>(),
    name: text('name').notNull(),
    path: text('path'),
    url: text('url'),
    referrer: text('referrer'),
    properties: jsonb('properties').$type<Record<string, unknown>>(),
    eventHash: text('event_hash').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    uniqueIndex('analytics_events_site_hash_uk').on(t.siteId, t.eventHash),
    index('analytics_events_site_time_idx').on(t.siteId, t.occurredAt),
    index('analytics_events_site_type_name_idx').on(t.siteId, t.type, t.name, t.occurredAt),
    index('analytics_events_site_path_idx').on(t.siteId, t.path, t.occurredAt),
  ],
);

export type AnalyticsSession = typeof analyticsSessions.$inferSelect;
export type NewAnalyticsSession = typeof analyticsSessions.$inferInsert;
export type AnalyticsEvent = typeof analyticsEvents.$inferSelect;
export type NewAnalyticsEvent = typeof analyticsEvents.$inferInsert;
