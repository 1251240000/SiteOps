import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { decodeCursor } from '@siteops/shared';

import { sites } from '../../schema/sites.js';
import { uptimeChecks, type NewUptimeCheck } from '../../schema/uptime-checks.js';
import { createTestDb, type TestDbHandle } from '../../testing.js';
import { uptimeRepo } from '../uptime-repo.js';

let handle: TestDbHandle;

async function seedSite(slug = 'fixture-uptime'): Promise<string> {
  const [row] = await handle.db
    .insert(sites)
    .values({
      slug,
      name: 'Fixture',
      primaryUrl: `https://${slug}.example.com`,
      siteType: 'tool',
      status: 'active',
    })
    .returning({ id: sites.id });
  if (!row) throw new Error('seedSite');
  return row.id;
}

async function seedCheck(input: Partial<NewUptimeCheck> & { siteId: string }): Promise<bigint> {
  const [row] = await handle.db
    .insert(uptimeChecks)
    .values({
      siteId: input.siteId,
      url: input.url ?? 'https://fixture.example.com',
      checkedAt: input.checkedAt ?? new Date(),
      ok: input.ok ?? true,
      statusCode: input.statusCode ?? 200,
      responseTimeMs: input.responseTimeMs ?? 100,
      region: input.region ?? 'local',
    })
    .returning({ id: uptimeChecks.id });
  if (!row) throw new Error('seedCheck');
  return row.id;
}

describe('uptimeRepo', () => {
  beforeEach(async () => {
    if (!handle) handle = await createTestDb();
    await handle.reset();
  });

  afterAll(async () => {
    if (handle) await handle.close();
  });

  describe('listCursor', () => {
    it('walks the full set of checks for a site without duplicates or gaps', async () => {
      const siteId = await seedSite('walk-target');
      const ids: bigint[] = [];
      // Seed 9 rows over a 9-second window so checkedAt is monotonic.
      const base = Date.now() - 60_000;
      for (let i = 0; i < 9; i++) {
        ids.push(
          await seedCheck({
            siteId,
            checkedAt: new Date(base + i * 1000),
            ok: i % 3 !== 0,
          }),
        );
      }
      // Site should not bleed checks from other sites.
      const otherSite = await seedSite('walk-other');
      await seedCheck({ siteId: otherSite });
      await seedCheck({ siteId: otherSite });

      const seen: bigint[] = [];
      let cursor;
      let hasMore = true;
      let pages = 0;
      while (hasMore) {
        pages += 1;
        if (pages > 6) throw new Error('infinite loop guard');
        const page = await uptimeRepo.listCursor(handle.db as never, siteId, {
          limit: 4,
          ...(cursor ? { cursor } : {}),
        });
        for (const r of page.items) seen.push(r.id);
        hasMore = page.hasMore;
        cursor = page.nextCursor ? (decodeCursor(page.nextCursor) ?? undefined) : undefined;
        if (!hasMore) expect(page.nextCursor).toBeNull();
      }
      expect(pages).toBe(3);
      // Newest-first walk = ids reversed.
      expect(seen).toEqual([...ids].reverse());
      expect(new Set(seen.map(String)).size).toBe(seen.length);
    });

    it('encodes / decodes bigint ids losslessly through the cursor', async () => {
      const siteId = await seedSite('bigint-target');
      // Seed enough rows to need a follow-up page.
      for (let i = 0; i < 5; i++) {
        await seedCheck({ siteId, checkedAt: new Date(Date.now() - 60_000 + i * 1000) });
      }
      const page1 = await uptimeRepo.listCursor(handle.db as never, siteId, { limit: 2 });
      expect(page1.items).toHaveLength(2);
      expect(page1.nextCursor).not.toBeNull();
      const decoded = decodeCursor(page1.nextCursor!);
      expect(decoded?.id).toBe(String(page1.items[1]!.id));
      // Round-trip back into the repo and verify forward progress.
      const page2 = await uptimeRepo.listCursor(handle.db as never, siteId, {
        limit: 2,
        cursor: decoded!,
      });
      expect(page2.items.map((r) => r.id)).not.toContain(page1.items[0]!.id);
      expect(page2.items.map((r) => r.id)).not.toContain(page1.items[1]!.id);
    });

    it('honours failuresOnly together with the cursor', async () => {
      const siteId = await seedSite('fail-only');
      for (let i = 0; i < 6; i++) {
        await seedCheck({
          siteId,
          checkedAt: new Date(Date.now() - 60_000 + i * 1000),
          ok: i % 2 === 0, // alternating ok / fail
        });
      }
      let cursor;
      const failures: bigint[] = [];
      let hasMore = true;
      while (hasMore) {
        const page = await uptimeRepo.listCursor(handle.db as never, siteId, {
          limit: 2,
          failuresOnly: true,
          ...(cursor ? { cursor } : {}),
        });
        for (const r of page.items) {
          expect(r.ok).toBe(false);
          failures.push(r.id);
        }
        hasMore = page.hasMore;
        cursor = page.nextCursor ? (decodeCursor(page.nextCursor) ?? undefined) : undefined;
      }
      // Three of the six rows had ok=false (i=1,3,5).
      expect(failures).toHaveLength(3);
    });

    it('returns empty page with hasMore=false when cursor is past all rows', async () => {
      const siteId = await seedSite('past-end');
      await seedCheck({ siteId });
      const page = await uptimeRepo.listCursor(handle.db as never, siteId, {
        limit: 5,
        cursor: { id: '0', ts: '1970-01-01T00:00:00.000Z' },
      });
      expect(page.items).toEqual([]);
      expect(page.hasMore).toBe(false);
      expect(page.nextCursor).toBeNull();
    });
  });
});
