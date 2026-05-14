import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { deployments, sites } from '@siteops/db';
import { createTestDb, type TestDbHandle } from '@siteops/db/testing';
import { AppError } from '@siteops/shared';

import { computeDurationMs, deploymentService } from '../deployment-service.js';

let handle: TestDbHandle;
const deps = () => ({ db: handle.db as never });

async function seedSite(slug: string): Promise<string> {
  const [row] = await handle.db
    .insert(sites)
    .values({
      slug,
      name: slug,
      primaryUrl: `https://${slug}.example.com`,
      siteType: 'tool',
    })
    .returning({ id: sites.id });
  if (!row) throw new Error('seedSite');
  return row.id;
}

describe('deploymentService', () => {
  beforeEach(async () => {
    if (!handle) handle = await createTestDb();
    await handle.reset();
  });

  afterAll(async () => {
    if (handle) await handle.close();
  });

  describe('computeDurationMs', () => {
    it('returns null when either endpoint is missing', () => {
      expect(computeDurationMs(null, null)).toBeNull();
      expect(computeDurationMs(new Date(), null)).toBeNull();
      expect(computeDurationMs(null, new Date())).toBeNull();
    });
    it('computes ms between two dates', () => {
      const s = new Date('2026-05-01T00:00:00Z');
      const f = new Date('2026-05-01T00:00:02Z');
      expect(computeDurationMs(s, f)).toBe(2000);
    });
    it('accepts ISO strings', () => {
      expect(computeDurationMs('2026-05-01T00:00:00Z', '2026-05-01T00:00:01Z')).toBe(1000);
    });
    it('returns null on negative durations', () => {
      const f = new Date('2026-05-01T00:00:00Z');
      const s = new Date('2026-05-01T00:00:02Z');
      expect(computeDurationMs(s, f)).toBeNull();
    });
  });

  describe('create', () => {
    it('inserts a new row on first POST', async () => {
      const siteId = await seedSite('site');
      const out = await deploymentService.create(deps(), {
        siteId,
        provider: 'cloudflare_pages',
        providerDeploymentId: 'cf-1',
        status: 'queued',
      });
      expect(out.created).toBe(true);
      expect(out.deployment.status).toBe('queued');
    });

    it('is idempotent for the same (provider, providerDeploymentId): repeats merge with state-machine', async () => {
      const siteId = await seedSite('site');
      const a = await deploymentService.create(deps(), {
        siteId,
        provider: 'cloudflare_pages',
        providerDeploymentId: 'cf-1',
        status: 'queued',
      });
      const b = await deploymentService.create(deps(), {
        siteId,
        provider: 'cloudflare_pages',
        providerDeploymentId: 'cf-1',
        status: 'building',
      });
      expect(b.created).toBe(false);
      expect(b.deployment.id).toBe(a.deployment.id);
      expect(b.deployment.status).toBe('building');
    });

    it('refuses to move a terminal deployment to a non-terminal status', async () => {
      const siteId = await seedSite('site');
      await deploymentService.create(deps(), {
        siteId,
        provider: 'cloudflare_pages',
        providerDeploymentId: 'cf-1',
        status: 'success',
      });
      let err: unknown;
      try {
        await deploymentService.create(deps(), {
          siteId,
          provider: 'cloudflare_pages',
          providerDeploymentId: 'cf-1',
          status: 'building',
        });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('conflict');
      expect((err as AppError).status).toBe(409);
    });

    it('refuses to move queued → success (skipping building)', async () => {
      const siteId = await seedSite('site');
      await deploymentService.create(deps(), {
        siteId,
        provider: 'github_pages',
        providerDeploymentId: 'gh-1',
        status: 'queued',
      });
      let err: unknown;
      try {
        await deploymentService.create(deps(), {
          siteId,
          provider: 'github_pages',
          providerDeploymentId: 'gh-1',
          status: 'success',
        });
      } catch (e) {
        err = e;
      }
      expect((err as AppError).code).toBe('conflict');
    });

    it('accepts lateral re-asserts of the same status (webhook retry)', async () => {
      const siteId = await seedSite('site');
      const a = await deploymentService.create(deps(), {
        siteId,
        provider: 'vercel',
        providerDeploymentId: 'v-1',
        status: 'building',
      });
      const b = await deploymentService.create(deps(), {
        siteId,
        provider: 'vercel',
        providerDeploymentId: 'v-1',
        status: 'building',
      });
      expect(b.created).toBe(false);
      expect(b.deployment.id).toBe(a.deployment.id);
    });

    it('computes durationMs when finishedAt becomes known on a follow-up POST', async () => {
      const siteId = await seedSite('site');
      const start = '2026-05-01T00:00:00Z';
      const end = '2026-05-01T00:00:42Z';
      await deploymentService.create(deps(), {
        siteId,
        provider: 'cloudflare_pages',
        providerDeploymentId: 'cf-2',
        status: 'building',
        startedAt: start,
      });
      const out = await deploymentService.create(deps(), {
        siteId,
        provider: 'cloudflare_pages',
        providerDeploymentId: 'cf-2',
        status: 'success',
        startedAt: start,
        finishedAt: end,
      });
      expect(out.deployment.durationMs).toBe(42_000);
    });

    it('manual entries (no providerDeploymentId) always insert a new row', async () => {
      const siteId = await seedSite('site');
      const a = await deploymentService.create(deps(), {
        siteId,
        provider: 'manual',
        commitSha: 'sha-a',
        status: 'success',
      });
      const b = await deploymentService.create(deps(), {
        siteId,
        provider: 'manual',
        commitSha: 'sha-b',
        status: 'success',
      });
      expect(a.created).toBe(true);
      expect(b.created).toBe(true);
      expect(a.deployment.id).not.toBe(b.deployment.id);
      const all = await handle.db.select().from(deployments);
      expect(all).toHaveLength(2);
    });

    it('emits deployment.created via logger.info', async () => {
      const siteId = await seedSite('site');
      const events: Array<{ obj: Record<string, unknown> }> = [];
      const logger = {
        info: (obj: Record<string, unknown>) => events.push({ obj }),
        warn: () => {},
      };
      await deploymentService.create(
        { db: handle.db as never, logger },
        {
          siteId,
          provider: 'manual',
          commitSha: 'sha-1',
          status: 'success',
        },
      );
      expect(events.some((e) => e.obj['event'] === 'deployment.created')).toBe(true);
    });
  });

  describe('getById', () => {
    it('throws 404 on missing', async () => {
      let err: unknown;
      try {
        await deploymentService.getById(deps(), '00000000-0000-0000-0000-000000000000');
      } catch (e) {
        err = e;
      }
      expect((err as AppError).status).toBe(404);
    });
  });
});
