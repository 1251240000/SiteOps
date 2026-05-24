import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { sites } from '../../schema/sites.js';
import { errors, type NewErrorRow } from '../../schema/errors.js';
import { createTestDb, type TestDbHandle } from '../../testing.js';
import { errorRepo } from '../error-repo.js';

let handle: TestDbHandle;

async function seedSite(slug = 'errors-fixture'): Promise<string> {
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

async function seedError(input: Partial<NewErrorRow> & { siteId: string }): Promise<string> {
  const [row] = await handle.db
    .insert(errors)
    .values({
      siteId: input.siteId,
      source: input.source ?? 'js',
      level: input.level ?? 'error',
      fingerprint: input.fingerprint ?? `fp-${Math.random().toString(16).slice(2)}`,
      message: input.message ?? 'boom',
      stack: input.stack ?? null,
      ...(input.firstSeenAt ? { firstSeenAt: input.firstSeenAt } : {}),
      ...(input.lastSeenAt ? { lastSeenAt: input.lastSeenAt } : {}),
      count: input.count ?? 1,
    })
    .returning({ id: errors.id });
  if (!row) throw new Error('seedError');
  return row.id;
}

describe('errorRepo', () => {
  beforeEach(async () => {
    if (!handle) handle = await createTestDb();
    await handle.reset();
  });

  afterAll(async () => {
    if (handle) await handle.close();
  });

  describe('list (offset)', () => {
    it('orders by last_seen_at DESC, paginates with page/limit, returns totals', async () => {
      const siteId = await seedSite('list-target');
      const now = Date.now();
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        ids.push(
          await seedError({
            siteId,
            fingerprint: `fp-${i}`,
            lastSeenAt: new Date(now - (5 - i) * 60_000),
          }),
        );
      }

      const page1 = await errorRepo.list(handle.db as never, { limit: 2, page: 1 });
      expect(page1.items.map((r) => r.id)).toEqual([ids[4], ids[3]]);
      expect(page1.total).toBe(5);
      expect(page1.hasMore).toBe(true);
      expect(page1.nextCursor).not.toBeNull();

      const page3 = await errorRepo.list(handle.db as never, { limit: 2, page: 3 });
      expect(page3.items.map((r) => r.id)).toEqual([ids[0]]);
      expect(page3.hasMore).toBe(false);
    });

    it('respects siteId / level / resolved filters', async () => {
      const a = await seedSite('a');
      const b = await seedSite('b');
      await seedError({ siteId: a, level: 'error' });
      await seedError({ siteId: a, level: 'warning' });
      await seedError({ siteId: b, level: 'error' });

      const onlyA = await errorRepo.list(handle.db as never, { filters: { siteId: a } });
      expect(onlyA.total).toBe(2);

      const onlyErrors = await errorRepo.list(handle.db as never, { filters: { level: 'error' } });
      expect(onlyErrors.total).toBe(2);
    });
  });

  describe('cursor pagination', () => {
    it('walks the full list without duplicates or gaps', async () => {
      const siteId = await seedSite('cursor-walk');
      const now = Date.now();
      const ids: string[] = [];
      for (let i = 0; i < 8; i++) {
        ids.push(
          await seedError({
            siteId,
            fingerprint: `fp-${i}`,
            lastSeenAt: new Date(now - (8 - i) * 60_000),
          }),
        );
      }
      const seen: string[] = [];
      let cursor;
      let hasMore = true;
      let pages = 0;
      while (hasMore) {
        pages += 1;
        if (pages > 6) throw new Error('infinite loop guard');
        const page = await errorRepo.list(handle.db as never, {
          limit: 3,
          ...(cursor ? { cursor } : {}),
        });
        for (const r of page.items) seen.push(r.id);
        hasMore = page.hasMore;
        cursor = page.nextCursor
          ? (JSON.parse(Buffer.from(page.nextCursor, 'base64url').toString('utf8')) as {
              id: string;
              ts: string;
            })
          : undefined;
      }
      expect(pages).toBe(3); // 3+3+2
      expect(seen).toEqual([...ids].reverse());
      expect(new Set(seen).size).toBe(seen.length);
    });

    it('honours the `resolved` filter while cursor-walking', async () => {
      const siteId = await seedSite('cursor-resolved');
      const now = Date.now();
      for (let i = 0; i < 4; i++) {
        const id = await seedError({
          siteId,
          fingerprint: `fp-${i}`,
          lastSeenAt: new Date(now - (4 - i) * 60_000),
        });
        if (i % 2 === 0) {
          await errorRepo.setResolved(handle.db as never, id, true);
        }
      }
      // Unresolved only: should see exactly 2 rows across all pages.
      let cursor;
      let hasMore = true;
      const ids: string[] = [];
      while (hasMore) {
        const page = await errorRepo.list(handle.db as never, {
          limit: 1,
          filters: { resolved: false },
          ...(cursor ? { cursor } : {}),
        });
        for (const r of page.items) {
          expect(r.resolvedAt).toBeNull();
          ids.push(r.id);
        }
        hasMore = page.hasMore;
        cursor = page.nextCursor
          ? (JSON.parse(Buffer.from(page.nextCursor, 'base64url').toString('utf8')) as {
              id: string;
              ts: string;
            })
          : undefined;
      }
      expect(ids).toHaveLength(2);
    });

    it('returns empty page + null cursor past the tail', async () => {
      const siteId = await seedSite('past-tail');
      await seedError({ siteId, fingerprint: 'only' });
      const out = await errorRepo.list(handle.db as never, {
        limit: 5,
        cursor: { id: '00000000-0000-0000-0000-000000000000', ts: '1970-01-01T00:00:00.000Z' },
      });
      expect(out.items).toEqual([]);
      expect(out.hasMore).toBe(false);
      expect(out.nextCursor).toBeNull();
    });
  });
});
