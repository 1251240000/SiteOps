import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDb, type TestDbHandle } from '../../testing.js';
import { sites } from '../../schema/sites.js';
import { siteCostRepo } from '../site-cost-repo.js';

let handle: TestDbHandle;

async function seedSite(slug = `s-${Math.random().toString(36).slice(2, 8)}`): Promise<string> {
  const [row] = await handle.db
    .insert(sites)
    .values({
      slug,
      name: slug,
      primaryUrl: `https://${slug}.example.com`,
      siteType: 'tool',
    })
    .returning({ id: sites.id });
  if (!row) throw new Error('seedSite: insert returned no row');
  return row.id;
}

beforeEach(async () => {
  if (!handle) handle = await createTestDb();
  await handle.reset();
});

afterAll(async () => {
  if (handle) await handle.close();
});

describe('siteCostRepo', () => {
  describe('create + getById + getByMonth + listForSite', () => {
    it('inserts a row and round-trips it through every read path', async () => {
      const siteId = await seedSite();
      const created = await siteCostRepo.create(handle.db as never, {
        siteId,
        month: '2026-04-01',
        hostingUsd: 12,
        domainUsd: 1,
        contentUsd: 50,
        adsSpendUsd: 20,
        otherUsd: 0,
        notes: 'april',
      });
      expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(created.hostingUsd).toBe('12.0000');
      expect(created.notes).toBe('april');

      const byId = await siteCostRepo.getById(handle.db as never, created.id);
      expect(byId?.id).toBe(created.id);

      const byMonth = await siteCostRepo.getByMonth(handle.db as never, siteId, '2026-04-01');
      expect(byMonth?.id).toBe(created.id);

      const list = await siteCostRepo.listForSite(handle.db as never, siteId);
      expect(list.map((r) => r.id)).toEqual([created.id]);
    });

    it('rejects months that are not the 1st of the month', async () => {
      const siteId = await seedSite();
      await expect(
        siteCostRepo.create(handle.db as never, {
          siteId,
          month: '2026-04-15',
          hostingUsd: 1,
        }),
      ).rejects.toThrow(/first day of a month/i);
    });

    it('returns null on missing id / missing month', async () => {
      const siteId = await seedSite();
      expect(
        await siteCostRepo.getById(handle.db as never, '00000000-0000-0000-0000-000000000000'),
      ).toBeNull();
      expect(await siteCostRepo.getByMonth(handle.db as never, siteId, '2026-04-01')).toBeNull();
    });
  });

  describe('unique constraint', () => {
    it('throws when inserting a second row for the same (site, month)', async () => {
      const siteId = await seedSite();
      await siteCostRepo.create(handle.db as never, {
        siteId,
        month: '2026-04-01',
        hostingUsd: 1,
      });
      // PGlite wraps the constraint violation message in "Failed query: ..."
      // so we just assert the call rejects; the upstream Postgres SQLSTATE
      // (23505) is exercised by integration tests against real PG.
      await expect(
        siteCostRepo.create(handle.db as never, {
          siteId,
          month: '2026-04-01',
          hostingUsd: 2,
        }),
      ).rejects.toThrow();
    });
  });

  describe('update', () => {
    it('patches selected columns and clears notes on null', async () => {
      const siteId = await seedSite();
      const created = await siteCostRepo.create(handle.db as never, {
        siteId,
        month: '2026-04-01',
        hostingUsd: 12,
        notes: 'first draft',
      });
      const updated = await siteCostRepo.update(handle.db as never, created.id, {
        hostingUsd: 14,
        notes: null,
      });
      expect(updated?.hostingUsd).toBe('14.0000');
      expect(updated?.notes).toBeNull();
    });

    it('returns null when updating an unknown id', async () => {
      expect(
        await siteCostRepo.update(handle.db as never, '00000000-0000-0000-0000-000000000000', {
          hostingUsd: 1,
        }),
      ).toBeNull();
    });
  });

  describe('delete', () => {
    it('returns true on success and false on missing id', async () => {
      const siteId = await seedSite();
      const created = await siteCostRepo.create(handle.db as never, {
        siteId,
        month: '2026-04-01',
        hostingUsd: 1,
      });
      expect(await siteCostRepo.delete(handle.db as never, created.id)).toBe(true);
      expect(await siteCostRepo.delete(handle.db as never, created.id)).toBe(false);
    });
  });

  describe('listOverlapping', () => {
    it('returns rows whose month overlaps [from, to] and filters by site', async () => {
      const a = await seedSite('a');
      const b = await seedSite('b');
      const aMar = await siteCostRepo.create(handle.db as never, {
        siteId: a,
        month: '2026-03-01',
        hostingUsd: 5,
      });
      const aApr = await siteCostRepo.create(handle.db as never, {
        siteId: a,
        month: '2026-04-01',
        hostingUsd: 5,
      });
      const aMay = await siteCostRepo.create(handle.db as never, {
        siteId: a,
        month: '2026-05-01',
        hostingUsd: 5,
      });
      const bApr = await siteCostRepo.create(handle.db as never, {
        siteId: b,
        month: '2026-04-01',
        hostingUsd: 5,
      });

      // Window crosses March → April: should pick March + April for site a.
      const out = await siteCostRepo.listOverlapping(
        handle.db as never,
        { from: '2026-03-15', to: '2026-04-15' },
        a,
      );
      expect(out.map((r) => r.id).sort()).toEqual([aMar.id, aApr.id].sort());
      expect(out.some((r) => r.id === aMay.id)).toBe(false);

      // Without siteId we get rows for both sites.
      const all = await siteCostRepo.listOverlapping(handle.db as never, {
        from: '2026-04-01',
        to: '2026-04-30',
      });
      expect(all.map((r) => r.id).sort()).toEqual([aApr.id, bApr.id].sort());
    });
  });
});
