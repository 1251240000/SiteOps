import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDb, type TestDbHandle } from '../../testing.js';
import { sites } from '../../schema/sites.js';
import { affiliateEntryRepo } from '../affiliate-entry-repo.js';

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

describe('affiliateEntryRepo', () => {
  beforeEach(async () => {
    if (!handle) handle = await createTestDb();
    await handle.reset();
  });

  afterAll(async () => {
    if (handle) await handle.close();
  });

  describe('create + getById + listForSite', () => {
    it('inserts a row, returns it by id, and surfaces it in listForSite', async () => {
      const siteId = await seedSite();
      const entry = await affiliateEntryRepo.create(handle.db as never, {
        siteId,
        periodStart: '2026-04-01',
        periodEnd: '2026-04-30',
        program: 'Amazon',
        amountUsd: 123.45,
        amountRaw: 800,
        currency: 'CNY',
        payoutDate: '2026-05-15',
        notes: 'monthly payout',
      });
      expect(entry.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(entry.amountUsd).toBe('123.4500');
      expect(entry.amountRaw).toBe('800.0000');
      expect(entry.currency).toBe('CNY');

      const fetched = await affiliateEntryRepo.getById(handle.db as never, entry.id);
      expect(fetched?.id).toBe(entry.id);

      const list = await affiliateEntryRepo.listForSite(handle.db as never, siteId);
      expect(list.map((r) => r.id)).toEqual([entry.id]);
    });

    it('returns null for unknown id', async () => {
      expect(
        await affiliateEntryRepo.getById(
          handle.db as never,
          '00000000-0000-0000-0000-000000000000',
        ),
      ).toBeNull();
    });
  });

  describe('update', () => {
    it('patches selected fields and clears amount_raw / currency on null', async () => {
      const siteId = await seedSite();
      const entry = await affiliateEntryRepo.create(handle.db as never, {
        siteId,
        periodStart: '2026-04-01',
        periodEnd: '2026-04-30',
        program: 'Amazon',
        amountUsd: 100,
        amountRaw: 700,
        currency: 'CNY',
      });
      const updated = await affiliateEntryRepo.update(handle.db as never, entry.id, {
        program: 'Amazon Associates',
        amountUsd: 110,
        amountRaw: null,
        currency: null,
      });
      expect(updated?.program).toBe('Amazon Associates');
      expect(updated?.amountUsd).toBe('110.0000');
      expect(updated?.amountRaw).toBeNull();
      expect(updated?.currency).toBeNull();
    });

    it('returns null when updating an unknown id', async () => {
      expect(
        await affiliateEntryRepo.update(
          handle.db as never,
          '00000000-0000-0000-0000-000000000000',
          { program: 'x' },
        ),
      ).toBeNull();
    });
  });

  describe('delete', () => {
    it('removes the row and returns true', async () => {
      const siteId = await seedSite();
      const entry = await affiliateEntryRepo.create(handle.db as never, {
        siteId,
        periodStart: '2026-04-01',
        periodEnd: '2026-04-30',
        program: 'X',
        amountUsd: 1,
      });
      expect(await affiliateEntryRepo.delete(handle.db as never, entry.id)).toBe(true);
      expect(await affiliateEntryRepo.getById(handle.db as never, entry.id)).toBeNull();
    });

    it('returns false when nothing was deleted', async () => {
      expect(
        await affiliateEntryRepo.delete(handle.db as never, '00000000-0000-0000-0000-000000000000'),
      ).toBe(false);
    });
  });

  describe('listOverlapping', () => {
    it('returns rows whose period intersects [from, to] inclusive', async () => {
      const siteId = await seedSite();
      const a = await affiliateEntryRepo.create(handle.db as never, {
        siteId,
        periodStart: '2026-04-25',
        periodEnd: '2026-05-05',
        program: 'A',
        amountUsd: 10,
      }); // overlaps left edge
      const b = await affiliateEntryRepo.create(handle.db as never, {
        siteId,
        periodStart: '2026-05-10',
        periodEnd: '2026-05-15',
        program: 'B',
        amountUsd: 20,
      }); // fully inside
      const c = await affiliateEntryRepo.create(handle.db as never, {
        siteId,
        periodStart: '2026-05-25',
        periodEnd: '2026-06-05',
        program: 'C',
        amountUsd: 30,
      }); // overlaps right edge
      // Outside the window
      await affiliateEntryRepo.create(handle.db as never, {
        siteId,
        periodStart: '2026-06-10',
        periodEnd: '2026-06-15',
        program: 'D',
        amountUsd: 40,
      });
      const out = await affiliateEntryRepo.listOverlapping(handle.db as never, {
        from: '2026-05-01',
        to: '2026-05-31',
      });
      expect(out.map((r) => r.id).sort()).toEqual([a.id, b.id, c.id].sort());
    });

    it('filters to a single site when siteId is passed', async () => {
      const a = await seedSite('a');
      const b = await seedSite('b');
      const aEntry = await affiliateEntryRepo.create(handle.db as never, {
        siteId: a,
        periodStart: '2026-05-01',
        periodEnd: '2026-05-10',
        program: 'A',
        amountUsd: 5,
      });
      await affiliateEntryRepo.create(handle.db as never, {
        siteId: b,
        periodStart: '2026-05-01',
        periodEnd: '2026-05-10',
        program: 'B',
        amountUsd: 5,
      });
      const out = await affiliateEntryRepo.listOverlapping(
        handle.db as never,
        { from: '2026-05-01', to: '2026-05-31' },
        a,
      );
      expect(out.map((r) => r.id)).toEqual([aEntry.id]);
    });
  });
});
