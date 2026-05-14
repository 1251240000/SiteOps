import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { domains, sites } from '@siteops/db';
import { createTestDb, type TestDbHandle } from '@siteops/db/testing';
import { AppError } from '@siteops/shared';

import { siteService } from '../site-service.js';

let handle: TestDbHandle;
const deps = () => ({ db: handle.db as never });

describe('siteService', () => {
  beforeEach(async () => {
    if (!handle) handle = await createTestDb();
    await handle.reset();
  });

  afterAll(async () => {
    if (handle) await handle.close();
  });

  describe('create', () => {
    it('derives a slug from name and writes the primary domain', async () => {
      const site = await siteService.create(deps(), {
        name: 'Docs Example',
        primaryUrl: 'https://docs.example.com',
        siteType: 'content',
        status: 'active',
        tags: [],
      });
      expect(site.slug).toBe('docs-example');
      expect(site.healthScore).toBe(100);
      expect(site.status).toBe('active');

      const linkedDomains = await handle.db.select().from(domains);
      expect(linkedDomains).toHaveLength(1);
      expect(linkedDomains[0]?.domain).toBe('docs.example.com');
      expect(linkedDomains[0]?.isPrimary).toBe(true);
      expect(linkedDomains[0]?.siteId).toBe(site.id);
    });

    it('resolves slug conflicts by appending -2 / -3', async () => {
      const a = await siteService.create(deps(), {
        name: 'Foo',
        primaryUrl: 'https://foo.example.com',
        siteType: 'tool',
        status: 'active',
        tags: [],
      });
      const b = await siteService.create(deps(), {
        name: 'Foo',
        primaryUrl: 'https://foo2.example.com',
        siteType: 'tool',
        status: 'active',
        tags: [],
      });
      const c = await siteService.create(deps(), {
        name: 'Foo',
        primaryUrl: 'https://foo3.example.com',
        siteType: 'tool',
        status: 'active',
        tags: [],
      });
      expect(a.slug).toBe('foo');
      expect(b.slug).toBe('foo-2');
      expect(c.slug).toBe('foo-3');
    });

    it('respects an explicit slug when supplied', async () => {
      const site = await siteService.create(deps(), {
        name: 'Anything',
        slug: 'custom-slug',
        primaryUrl: 'https://x.example.com',
        siteType: 'tool',
        status: 'active',
        tags: [],
      });
      expect(site.slug).toBe('custom-slug');
    });

    it('emits site.created via logger.info when provided', async () => {
      const events: Array<{ obj: Record<string, unknown>; msg: string | undefined }> = [];
      const logger = {
        info: (obj: Record<string, unknown>, msg?: string) => events.push({ obj, msg }),
        warn: () => {},
      };
      await siteService.create(
        { db: handle.db as never, logger },
        {
          name: 'Logged',
          primaryUrl: 'https://logged.example.com',
          siteType: 'tool',
          status: 'active',
          tags: [],
        },
      );
      const created = events.find((e) => e.obj['event'] === 'site.created');
      expect(created).toBeDefined();
      expect(created!.obj['slug']).toBe('logged');
    });
  });

  describe('getById', () => {
    it('throws AppError(404) on missing id', async () => {
      let err: unknown;
      try {
        await siteService.getById(deps(), '00000000-0000-0000-0000-000000000000');
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).status).toBe(404);
      expect((err as AppError).code).toBe('not_found');
    });
  });

  describe('update', () => {
    it('refuses to rewrite slug', async () => {
      const s = await siteService.create(deps(), {
        name: 'A',
        primaryUrl: 'https://a.example.com',
        siteType: 'tool',
        status: 'active',
        tags: [],
      });
      let err: unknown;
      try {
        await siteService.update(deps(), s.id, { slug: 'b' });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('validation_failed');
    });

    it('strips undefined keys so optional fields stay untouched', async () => {
      const s = await siteService.create(deps(), {
        name: 'Original',
        primaryUrl: 'https://orig.example.com',
        siteType: 'tool',
        status: 'active',
        tags: ['v1'],
        notes: 'first notes',
      });
      const out = await siteService.update(deps(), s.id, {
        name: 'Renamed',
        // notes intentionally omitted (undefined) — must remain unchanged
      });
      expect(out.name).toBe('Renamed');
      expect(out.notes).toBe('first notes');
    });
  });

  describe('archive', () => {
    it('sets status="archived" and emits site.archived', async () => {
      const events: Array<{ obj: Record<string, unknown> }> = [];
      const logger = {
        info: (obj: Record<string, unknown>) => events.push({ obj }),
        warn: () => {},
      };
      const s = await siteService.create(deps(), {
        name: 'Gone',
        primaryUrl: 'https://gone.example.com',
        siteType: 'tool',
        status: 'active',
        tags: [],
      });
      const out = await siteService.archive({ db: handle.db as never, logger }, s.id);
      expect(out.status).toBe('archived');
      const archivedEvt = events.find((e) => e.obj['event'] === 'site.archived');
      expect(archivedEvt).toBeDefined();

      // Row still exists in DB but is hidden by the default list filter.
      const all = await handle.db.select().from(sites);
      expect(all.find((r) => r.id === s.id)?.status).toBe('archived');
    });
  });
});
