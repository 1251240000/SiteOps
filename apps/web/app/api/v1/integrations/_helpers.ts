import { integrationStateRepo, type IntegrationProvider } from '@siteops/db';

import { getDb } from '@/lib/db';

/** Build the state envelope returned by status endpoints. */
export async function readIntegrationStatus(provider: IntegrationProvider): Promise<{
  configured: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
  perSite: Array<{
    siteId: string | null;
    lastSyncedAt: string | null;
    lastError: string | null;
  }>;
}> {
  const db = getDb();
  const rows = await integrationStateRepo.listForProvider(db, provider);
  const global = rows.find((r) => r.siteId === null);
  return {
    configured: rows.length > 0,
    lastSyncedAt: global?.lastSyncedAt?.toISOString() ?? null,
    lastError: global?.lastError ?? null,
    perSite: rows
      .filter((r) => r.siteId !== null)
      .map((r) => ({
        siteId: r.siteId,
        lastSyncedAt: r.lastSyncedAt?.toISOString() ?? null,
        lastError: r.lastError,
      })),
  };
}
