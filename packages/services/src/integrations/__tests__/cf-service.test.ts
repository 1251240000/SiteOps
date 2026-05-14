import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { integrationStateRepo, deploymentRepo } from '@siteops/db';
import { sites } from '@siteops/db/schema';
import { createTestDb, type TestDbHandle } from '@siteops/db/testing';
import type { cloudflare } from '@siteops/integrations';

import { cfService } from '../cf-service.js';

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
      slug: 'demo',
      name: 'demo',
      primaryUrl: 'https://demo.example.com',
      siteType: 'tool',
      cfAccountId: 'acc-1',
      cfPagesProject: 'demo-project',
    })
    .returning({ id: sites.id });
  if (!row) throw new Error('seed');
  siteId = row.id;
});

function fakeClient(deployments: cloudflare.CfPagesDeployment[]): cloudflare.CloudflareClient {
  return {
    verifyToken: async () => ({ id: 'token', status: 'active' as const }),
    listPagesProjects: async () => [],
    listDeployments: async () => deployments,
    getDeployment: async (_a: string, _b: string, id: string) =>
      deployments.find((d) => d.id === id) as cloudflare.CfPagesDeployment,
  } as unknown as cloudflare.CloudflareClient;
}

describe('cfService.syncSite', () => {
  it('writes deployments + records success state', async () => {
    const fakeDeployments: cloudflare.CfPagesDeployment[] = [
      {
        id: 'cf-1',
        project_name: 'demo-project',
        environment: 'production',
        created_on: '2026-01-02T00:00:00Z',
        url: 'https://cf-1.example.pages.dev',
        deployment_trigger: {
          metadata: { commit_hash: 'abc', commit_message: 'feat', branch: 'main' },
        },
        stages: [
          { name: 'queued', status: 'success' },
          { name: 'build', status: 'success' },
          {
            name: 'deploy',
            status: 'success',
            started_on: '2026-01-02T00:01:00Z',
            ended_on: '2026-01-02T00:02:00Z',
          },
        ],
      },
    ];
    const summary = await cfService.syncSite(
      { db: handle.db as never, clientFactory: () => fakeClient(fakeDeployments) },
      'tok',
      { id: siteId, cfAccountId: 'acc-1', cfPagesProject: 'demo-project' },
    );
    expect(summary.fetched).toBe(1);
    expect(summary.inserted).toBe(1);
    expect(summary.error).toBeUndefined();
    const list = await deploymentRepo.listForSite(handle.db as never, siteId);
    expect(list).toHaveLength(1);
    expect(list[0]?.providerDeploymentId).toBe('cf-1');
    const state = await integrationStateRepo.get(handle.db as never, 'cloudflare', siteId);
    expect(state?.lastSyncedAt).toBeInstanceOf(Date);
    expect(state?.lastError).toBeNull();
  });

  it('records last_error on failure and does not throw', async () => {
    const badClient = {
      listDeployments: async () => {
        throw new Error('boom');
      },
    } as unknown as cloudflare.CloudflareClient;
    const summary = await cfService.syncSite(
      { db: handle.db as never, clientFactory: () => badClient },
      'tok',
      { id: siteId, cfAccountId: 'acc-1', cfPagesProject: 'demo-project' },
    );
    expect(summary.error).toBe('boom');
    const state = await integrationStateRepo.get(handle.db as never, 'cloudflare', siteId);
    expect(state?.lastError).toBe('boom');
  });

  it('is idempotent: a second sync updates instead of duplicating', async () => {
    const dep: cloudflare.CfPagesDeployment = {
      id: 'cf-2',
      project_name: 'demo-project',
      environment: 'production',
      created_on: '2026-01-03T00:00:00Z',
      stages: [{ name: 'deploy', status: 'success' }],
    };
    const opts = {
      db: handle.db as never,
      clientFactory: () => fakeClient([dep]),
    };
    await cfService.syncSite(opts, 'tok', {
      id: siteId,
      cfAccountId: 'acc-1',
      cfPagesProject: 'demo-project',
    });
    const summary2 = await cfService.syncSite(opts, 'tok', {
      id: siteId,
      cfAccountId: 'acc-1',
      cfPagesProject: 'demo-project',
    });
    expect(summary2.inserted).toBe(0);
    expect(summary2.updated).toBe(1);
  });
});
