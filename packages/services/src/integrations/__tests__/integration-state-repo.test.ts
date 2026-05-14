import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { integrationStateRepo } from '@siteops/db';
import { sites } from '@siteops/db/schema';
import { createTestDb, type TestDbHandle } from '@siteops/db/testing';

let handle: TestDbHandle;
let siteId: string;

beforeAll(async () => {
  handle = await createTestDb();
});

afterAll(async () => {
  await handle.close();
});

beforeEach(async () => {
  await handle.reset();
  const [row] = await handle.db
    .insert(sites)
    .values({
      slug: 's',
      name: 's',
      primaryUrl: 'https://s.example.com',
      siteType: 'tool',
    })
    .returning({ id: sites.id });
  if (!row) throw new Error('seed');
  siteId = row.id;
});

describe('integrationStateRepo', () => {
  it('inserts then updates on second call (per-site)', async () => {
    await integrationStateRepo.markSuccess(handle.db as never, 'cloudflare', siteId);
    const after1 = await integrationStateRepo.get(handle.db as never, 'cloudflare', siteId);
    expect(after1?.lastError).toBeNull();
    expect(after1?.lastSyncedAt).toBeInstanceOf(Date);

    await integrationStateRepo.markError(handle.db as never, 'cloudflare', siteId, 'boom');
    const after2 = await integrationStateRepo.get(handle.db as never, 'cloudflare', siteId);
    expect(after2?.lastError).toBe('boom');
    // lastSyncedAt should remain from the prior success (not cleared by markError).
    expect(after2?.lastSyncedAt).toEqual(after1?.lastSyncedAt);
  });

  it('treats per-site and global rows as separate keys', async () => {
    await integrationStateRepo.markSuccess(handle.db as never, 'adsense', null);
    await integrationStateRepo.markSuccess(handle.db as never, 'adsense', siteId);
    const globalRow = await integrationStateRepo.get(handle.db as never, 'adsense', null);
    const siteRow = await integrationStateRepo.get(handle.db as never, 'adsense', siteId);
    expect(globalRow).not.toBeNull();
    expect(siteRow).not.toBeNull();
    expect(globalRow?.siteId).toBeNull();
    expect(siteRow?.siteId).toBe(siteId);
  });
});
