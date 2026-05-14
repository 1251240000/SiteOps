/**
 * Repository for `integration_credentials`.
 *
 * Stores encrypted refresh tokens (and short-lived access tokens) used by the
 * Google integrations (GSC, AdSense). The encryption is handled at the
 * service layer via the same `AlertCipher` used for alert channel configs;
 * this repo only persists the ciphertext blob.
 */
import { and, eq } from 'drizzle-orm';

import type { Db } from '../client.js';
import {
  integrationCredentials,
  type IntegrationCredentialRow,
  type NewIntegrationCredentialRow,
} from '../schema/integration-credentials.js';

export const integrationCredentialRepo = {
  async get(db: Db, provider: string, scope = 'default'): Promise<IntegrationCredentialRow | null> {
    const rows = await db
      .select()
      .from(integrationCredentials)
      .where(
        and(eq(integrationCredentials.provider, provider), eq(integrationCredentials.scope, scope)),
      )
      .limit(1);
    return rows[0] ?? null;
  },

  async upsert(
    db: Db,
    input: {
      provider: string;
      scope?: string;
      encryptedPayload: string;
      expiresAt?: Date | null;
    },
  ): Promise<IntegrationCredentialRow> {
    const scope = input.scope ?? 'default';
    const existing = await this.get(db, input.provider, scope);
    if (existing) {
      const rows = await db
        .update(integrationCredentials)
        .set({
          encryptedPayload: input.encryptedPayload,
          expiresAt: input.expiresAt ?? null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(integrationCredentials.provider, input.provider),
            eq(integrationCredentials.scope, scope),
          ),
        )
        .returning();
      const row = rows[0];
      if (!row) throw new Error('integrationCredentialRepo.upsert: update returned no row');
      return row;
    }
    const insert: NewIntegrationCredentialRow = {
      provider: input.provider,
      scope,
      encryptedPayload: input.encryptedPayload,
      expiresAt: input.expiresAt ?? null,
    };
    const rows = await db.insert(integrationCredentials).values(insert).returning();
    const row = rows[0];
    if (!row) throw new Error('integrationCredentialRepo.upsert: insert returned no row');
    return row;
  },

  async delete(db: Db, provider: string, scope = 'default'): Promise<void> {
    await db
      .delete(integrationCredentials)
      .where(
        and(eq(integrationCredentials.provider, provider), eq(integrationCredentials.scope, scope)),
      );
  },
};
