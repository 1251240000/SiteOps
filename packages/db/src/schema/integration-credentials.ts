/**
 * Long-lived integration credentials (OAuth refresh tokens, API tokens).
 *
 * Payloads are AES-256-GCM encrypted via `@siteops/services/alerts/cipher`
 * (same module used for alert channel configs) and stored as text. The shape
 * inside the payload depends on the provider:
 *   - `gsc`     → { refreshToken, accessToken?, expiresAt?, scope? }
 *   - `adsense` → { refreshToken, accessToken?, expiresAt?, scope? }
 *
 * One row per `(provider, scope)` where `scope` is an opaque tag the caller
 * picks (default `default`). Multi-account scenarios (e.g. a second AdSense
 * publisher) can add a row with a different scope without schema changes.
 */
import { pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const integrationCredentials = pgTable(
  'integration_credentials',
  {
    provider: text('provider').notNull(),
    scope: text('scope').notNull().default('default'),
    encryptedPayload: text('encrypted_payload').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('integration_credentials_uk').on(t.provider, t.scope)],
);

export type IntegrationCredentialRow = typeof integrationCredentials.$inferSelect;
export type NewIntegrationCredentialRow = typeof integrationCredentials.$inferInsert;
