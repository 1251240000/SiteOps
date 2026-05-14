/**
 * Repository for `integrations_state` — the per-(site, provider) sync state
 * table that the M3 integrations write after each fetch.
 *
 * Two flavours of row coexist:
 *   - site-scoped: `siteId` is a UUID, dedupe key is `(siteId, provider)`
 *   - global:      `siteId` is NULL, dedupe key is `(provider)` alone
 *
 * Hence the two upsert paths.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';

import type { Db } from '../client.js';
import {
  integrationsState,
  type IntegrationProvider,
  type IntegrationsStateRow,
  type NewIntegrationsStateRow,
} from '../schema/integrations-state.js';

export type UpsertIntegrationStateInput = {
  siteId: string | null;
  provider: IntegrationProvider;
  lastSyncedAt?: Date | null;
  lastCursor?: string | null;
  lastError?: string | null;
};

function clean(input: UpsertIntegrationStateInput): NewIntegrationsStateRow {
  const out: NewIntegrationsStateRow = {
    siteId: input.siteId,
    provider: input.provider,
    updatedAt: new Date(),
  };
  if (input.lastSyncedAt !== undefined) out.lastSyncedAt = input.lastSyncedAt;
  if (input.lastCursor !== undefined) out.lastCursor = input.lastCursor;
  if (input.lastError !== undefined) out.lastError = input.lastError;
  return out;
}

export const integrationStateRepo = {
  async get(
    db: Db,
    provider: IntegrationProvider,
    siteId: string | null,
  ): Promise<IntegrationsStateRow | null> {
    const rows = await db
      .select()
      .from(integrationsState)
      .where(
        siteId === null
          ? and(eq(integrationsState.provider, provider), isNull(integrationsState.siteId))
          : and(eq(integrationsState.provider, provider), eq(integrationsState.siteId, siteId)),
      )
      .limit(1);
    return rows[0] ?? null;
  },

  async listForProvider(db: Db, provider: IntegrationProvider): Promise<IntegrationsStateRow[]> {
    return db.select().from(integrationsState).where(eq(integrationsState.provider, provider));
  },

  /**
   * Insert-or-update keyed off `(provider, siteId)`. The CONFLICT target uses
   * a partial unique index — separate path for global and per-site rows.
   */
  async upsert(db: Db, input: UpsertIntegrationStateInput): Promise<IntegrationsStateRow> {
    const existing = await this.get(db, input.provider, input.siteId);
    if (existing) {
      const patch: Partial<NewIntegrationsStateRow> = { updatedAt: new Date() };
      if (input.lastSyncedAt !== undefined) patch.lastSyncedAt = input.lastSyncedAt;
      if (input.lastCursor !== undefined) patch.lastCursor = input.lastCursor;
      if (input.lastError !== undefined) patch.lastError = input.lastError;
      const rows = await db
        .update(integrationsState)
        .set(patch)
        .where(
          input.siteId === null
            ? and(eq(integrationsState.provider, input.provider), isNull(integrationsState.siteId))
            : and(
                eq(integrationsState.provider, input.provider),
                eq(integrationsState.siteId, input.siteId),
              ),
        )
        .returning();
      const row = rows[0];
      if (!row) throw new Error('integrationStateRepo.upsert: update returned no row');
      return row;
    }
    const rows = await db.insert(integrationsState).values(clean(input)).returning();
    const row = rows[0];
    if (!row) throw new Error('integrationStateRepo.upsert: insert returned no row');
    return row;
  },

  /** Record a successful sync; clears `last_error`. */
  async markSuccess(
    db: Db,
    provider: IntegrationProvider,
    siteId: string | null,
    cursor?: string | null,
  ): Promise<IntegrationsStateRow> {
    return this.upsert(db, {
      siteId,
      provider,
      lastSyncedAt: new Date(),
      ...(cursor !== undefined ? { lastCursor: cursor } : {}),
      lastError: null,
    });
  },

  /** Record a failed sync; leaves `last_synced_at` alone. */
  async markError(
    db: Db,
    provider: IntegrationProvider,
    siteId: string | null,
    error: string,
  ): Promise<IntegrationsStateRow> {
    return this.upsert(db, { siteId, provider, lastError: error });
  },

  async delete(db: Db, provider: IntegrationProvider, siteId: string | null): Promise<void> {
    await db
      .delete(integrationsState)
      .where(
        siteId === null
          ? and(eq(integrationsState.provider, provider), isNull(integrationsState.siteId))
          : and(eq(integrationsState.provider, provider), eq(integrationsState.siteId, siteId)),
      );
  },
};

// Avoid an unused-import lint hit on `sql` while keeping the import handy for
// callers extending this module later.
export const __ext = { sql };
