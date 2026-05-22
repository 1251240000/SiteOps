/**
 * Smoke test for `pingDb`. Backed by PGlite via the shared testing helper
 * so we exercise the same `db.execute(sql\`SELECT 1\`)` shape that the
 * `apps/web` `/readyz` route relies on.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { pingDb } from '../health.js';
import type { Db } from '../client.js';
import { createTestDb, type TestDbHandle } from '../testing.js';

let handle: TestDbHandle;

beforeAll(async () => {
  handle = await createTestDb();
});

afterAll(async () => {
  await handle.close();
});

describe('pingDb', () => {
  it('resolves on a healthy connection', async () => {
    await expect(pingDb(handle.db as unknown as Db)).resolves.toBeUndefined();
  });

  it('rejects after the underlying client is closed', async () => {
    const local = await createTestDb();
    await local.close();
    await expect(pingDb(local.db as unknown as Db)).rejects.toThrow();
  });
});
