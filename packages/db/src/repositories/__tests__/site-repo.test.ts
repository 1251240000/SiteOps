import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDb, type TestDbHandle } from '../../testing.js';
import { sites } from '../../schema/sites.js';
import { siteRepo } from '../site-repo.js';

let handle: TestDbHandle;

async function seedSite(overrides: Partial<typeof sites.$inferInsert> = {}): Promise<string> {
  const slug = overrides.slug ?? `s-${Math.random().toString(36).slice(2, 8)}`;
  const [row] = await handle.db
    .insert(sites)
    .values({
      slug,
      name: overrides.name ?? slug,
      primaryUrl: overrides.primaryUrl ?? `https://${slug}.example.com`,
      siteType: overrides.siteType ?? 'tool',
      ...overrides,
    })
    .returning({ id: sites.id });
  if (!row) throw new Error('seedSite: insert returned no row');
  return row.id;
}

describe('siteRepo', () => {
  beforeEach(async () => {
    if (!handle) handle = await createTestDb();
    await handle.reset();
  });

  afterAll(async () => {
    if (handle) await handle.close();
  });

  describe('create + getById + getBySlug', () => {
    it('inserts a site and round-trips by id and slug', async () => {
      const id = await seedSite({
        slug: 'docs-example',
        name: 'Docs Example',
        primaryUrl: 'https://docs.example.com',
        siteType: 'content',
        tags: ['docs', 'reference'],
      });

      const byId = await siteRepo.getById(handle.db as never, id);
      expect(byId?.slug).toBe('docs-example');
      expect(byId?.healthScore).toBe(100);
      expect(byId?.status).toBe('active');
      expect(byId?.tags).toEqual(['docs', 'reference']);

      const bySlug = await siteRepo.getBySlug(handle.db as never, 'docs-example');
      expect(bySlug?.id).toBe(id);

      expect(
        await siteRepo.getById(handle.db as never, '00000000-0000-0000-0000-000000000000'),
      ).toBeNull();
      expect(await siteRepo.getBySlug(handle.db as never, 'nope')).toBeNull();
    });
  });

  describe('list', () => {
    it('returns paginated rows ordered by -created_at by default', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        // Sequential inserts → strictly increasing `created_at`.
        ids.push(await seedSite({ slug: `site-${i + 1}`, name: `Site ${i + 1}` }));
        await new Promise((r) => setTimeout(r, 10));
      }
      const page = await siteRepo.list(handle.db as never);
      expect(page.total).toBe(3);
      // Newest first
      expect(page.items.map((r) => r.slug)).toEqual(['site-3', 'site-2', 'site-1']);
    });

    it('honors page + limit', async () => {
      for (let i = 0; i < 5; i++) await seedSite({ slug: `s${i}` });
      const p1 = await siteRepo.list(handle.db as never, { page: 1, limit: 2 });
      const p2 = await siteRepo.list(handle.db as never, { page: 2, limit: 2 });
      expect(p1.items).toHaveLength(2);
      expect(p2.items).toHaveLength(2);
      expect(p1.total).toBe(5);
      expect(p2.total).toBe(5);
      const a = new Set(p1.items.map((r) => r.id));
      const b = new Set(p2.items.map((r) => r.id));
      expect([...a].every((id) => !b.has(id))).toBe(true);
    });

    it('hides archived rows by default; surfaces them via filter or flag', async () => {
      const liveId = await seedSite({ slug: 'live' });
      const archivedId = await seedSite({ slug: 'old', status: 'archived' });
      const noArchived = await siteRepo.list(handle.db as never);
      expect(noArchived.items.map((r) => r.id)).toContain(liveId);
      expect(noArchived.items.map((r) => r.id)).not.toContain(archivedId);

      const all = await siteRepo.list(handle.db as never, { filters: { includeArchived: true } });
      expect(all.items.map((r) => r.id)).toEqual(expect.arrayContaining([liveId, archivedId]));

      const onlyArchived = await siteRepo.list(handle.db as never, {
        filters: { status: 'archived' },
      });
      expect(onlyArchived.items.map((r) => r.id)).toEqual([archivedId]);
    });

    it('q filters by name / slug / primary_url (ILIKE)', async () => {
      await seedSite({ slug: 'foo', name: 'Foo' });
      await seedSite({ slug: 'bar-blog', name: 'Bar blog' });
      await seedSite({ slug: 'baz', name: 'baz', primaryUrl: 'https://baz.shop' });
      const a = await siteRepo.list(handle.db as never, { filters: { q: 'blog' } });
      expect(a.items.map((r) => r.slug)).toEqual(['bar-blog']);
      const b = await siteRepo.list(handle.db as never, { filters: { q: 'shop' } });
      expect(b.items.map((r) => r.slug)).toEqual(['baz']);
    });

    it('filters by siteType (single + array)', async () => {
      await seedSite({ slug: 'a', siteType: 'tool' });
      await seedSite({ slug: 'b', siteType: 'content' });
      await seedSite({ slug: 'c', siteType: 'directory' });
      const tools = await siteRepo.list(handle.db as never, { filters: { siteType: 'tool' } });
      expect(tools.items.map((r) => r.slug)).toEqual(['a']);
      const toolsOrContent = await siteRepo.list(handle.db as never, {
        filters: { siteType: ['tool', 'content'] },
      });
      expect(toolsOrContent.items.map((r) => r.slug).sort()).toEqual(['a', 'b']);
    });

    it('filters by country and tag', async () => {
      await seedSite({ slug: 'us', targetCountry: 'US', tags: ['vip'] });
      await seedSite({ slug: 'cn', targetCountry: 'CN', tags: ['vip'] });
      await seedSite({ slug: 'cn2', targetCountry: 'CN', tags: ['lite'] });
      const us = await siteRepo.list(handle.db as never, { filters: { country: 'US' } });
      expect(us.items.map((r) => r.slug)).toEqual(['us']);
      const vip = await siteRepo.list(handle.db as never, { filters: { tag: 'vip' } });
      expect(vip.items.map((r) => r.slug).sort()).toEqual(['cn', 'us']);
    });

    it('sorts by health_score ascending and name', async () => {
      await seedSite({ slug: 'low', name: 'B', healthScore: 30 });
      await seedSite({ slug: 'mid', name: 'A', healthScore: 60 });
      await seedSite({ slug: 'high', name: 'C', healthScore: 90 });
      const asc = await siteRepo.list(handle.db as never, { sort: 'health_score' });
      expect(asc.items.map((r) => r.slug)).toEqual(['low', 'mid', 'high']);
      const byName = await siteRepo.list(handle.db as never, { sort: 'name' });
      expect(byName.items.map((r) => r.name)).toEqual(['A', 'B', 'C']);
    });
  });

  describe('slugsLikeBase', () => {
    it('finds the base and any base-N suffix', async () => {
      await seedSite({ slug: 'foo' });
      await seedSite({ slug: 'foo-2' });
      await seedSite({ slug: 'foobar' }); // must NOT match
      const matches = (await siteRepo.slugsLikeBase(handle.db as never, 'foo')).sort();
      expect(matches).toEqual(['foo', 'foo-2']);
    });
  });

  describe('update + archive', () => {
    it('patches updatable fields and updated_at advances', async () => {
      const id = await seedSite({ slug: 'edit', name: 'before' });
      const before = await siteRepo.getById(handle.db as never, id);
      await new Promise((r) => setTimeout(r, 50));
      const updated = await siteRepo.update(handle.db as never, id, { name: 'after' });
      expect(updated?.name).toBe('after');
      expect(updated!.updatedAt.getTime()).toBeGreaterThan(before!.updatedAt.getTime());
    });

    it('archive sets status="archived" and hides from default list', async () => {
      const id = await seedSite({ slug: 'gone' });
      await siteRepo.archive(handle.db as never, id);
      const fresh = await siteRepo.getById(handle.db as never, id);
      expect(fresh?.status).toBe('archived');
      const list = await siteRepo.list(handle.db as never);
      expect(list.items.find((r) => r.id === id)).toBeUndefined();
    });

    it('returns null when updating a non-existent id', async () => {
      const res = await siteRepo.update(
        handle.db as never,
        '00000000-0000-0000-0000-000000000000',
        { name: 'x' },
      );
      expect(res).toBeNull();
    });
  });
});
