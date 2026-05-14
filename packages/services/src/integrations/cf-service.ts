/**
 * Cloudflare integration service.
 *
 * Driven by the `cf-sync` worker job: for every site that has a CF account
 * and Pages project configured, we fetch the latest deployments from CF and
 * upsert them via `deploymentService`. State (last_synced_at, last_cursor,
 * last_error) is tracked per-site in `integrations_state` so re-runs are
 * incremental.
 */

import { integrationStateRepo, siteRepo, type Db, type Site } from '@siteops/db';
import { cloudflare } from '@siteops/integrations';
import type { Logger } from '@siteops/shared';

import { deploymentService } from '../deployments/index.js';

export type CfServiceDeps = {
  db: Db;
  logger?: Pick<Logger, 'info' | 'warn' | 'error'>;
  /** Override for tests. */
  clientFactory?: (token: string) => cloudflare.CloudflareClient;
};

export type CfSyncSummary = {
  siteId: string;
  project: string;
  fetched: number;
  inserted: number;
  updated: number;
  error?: string;
};

const PROVIDER = 'cloudflare' as const;

function defaultClient(token: string): cloudflare.CloudflareClient {
  return new cloudflare.CloudflareClient({ apiToken: token });
}

export const cfService = {
  /** Probe the token; returns the resolved token-info payload. */
  async verifyToken(deps: CfServiceDeps, token: string): Promise<cloudflare.CfTokenVerification> {
    const client = (deps.clientFactory ?? defaultClient)(token);
    return client.verifyToken();
  },

  /** List Pages projects for an account; used by the site-settings drop-down. */
  async listProjects(
    deps: CfServiceDeps,
    token: string,
    accountId: string,
  ): Promise<Array<{ id: string; name: string; domains: string[] }>> {
    const client = (deps.clientFactory ?? defaultClient)(token);
    const projects = await client.listPagesProjects(accountId);
    return projects.map((p) => ({ id: p.id, name: p.name, domains: p.domains ?? [] }));
  },

  /** Sync a single site's Pages project. Idempotent via deploymentService upsert. */
  async syncSite(
    deps: CfServiceDeps,
    token: string,
    site: Pick<Site, 'id' | 'cfAccountId' | 'cfPagesProject'>,
    options: { sinceFallbackDays?: number } = {},
  ): Promise<CfSyncSummary> {
    if (!site.cfAccountId || !site.cfPagesProject) {
      throw new Error('cfService.syncSite: site missing cfAccountId/cfPagesProject');
    }
    const state = await integrationStateRepo.get(deps.db, PROVIDER, site.id);
    const sinceFallbackDays = options.sinceFallbackDays ?? 30;
    const fallback = new Date(Date.now() - sinceFallbackDays * 24 * 60 * 60 * 1000);
    const since = state?.lastSyncedAt ?? fallback;
    const summary: CfSyncSummary = {
      siteId: site.id,
      project: site.cfPagesProject,
      fetched: 0,
      inserted: 0,
      updated: 0,
    };
    try {
      const client = (deps.clientFactory ?? defaultClient)(token);
      const deployments = await client.listDeployments(site.cfAccountId, site.cfPagesProject, {
        since,
      });
      summary.fetched = deployments.length;
      for (const dep of deployments) {
        const norm = cloudflare.normalizeDeployment(dep);
        const result = await deploymentService.create(
          { db: deps.db, ...(deps.logger ? { logger: deps.logger } : {}) },
          {
            siteId: site.id,
            provider: 'cloudflare_pages',
            providerDeploymentId: norm.providerDeploymentId,
            ...(norm.commitSha ? { commitSha: norm.commitSha } : {}),
            ...(norm.commitMessage ? { commitMessage: norm.commitMessage } : {}),
            ...(norm.branch ? { branch: norm.branch } : {}),
            status: norm.status,
            ...(norm.startedAt ? { startedAt: norm.startedAt } : {}),
            ...(norm.finishedAt ? { finishedAt: norm.finishedAt } : {}),
            ...(norm.buildLogUrl ? { buildLogUrl: norm.buildLogUrl } : {}),
            triggeredBy: 'git_push',
          },
        );
        if (result.created) summary.inserted += 1;
        else summary.updated += 1;
      }
      await integrationStateRepo.markSuccess(deps.db, PROVIDER, site.id);
      deps.logger?.info(
        {
          event: 'cf.site_sync',
          siteId: site.id,
          fetched: summary.fetched,
          inserted: summary.inserted,
          updated: summary.updated,
        },
        'cf site sync done',
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      summary.error = msg;
      await integrationStateRepo.markError(deps.db, PROVIDER, site.id, msg);
      deps.logger?.warn(
        { event: 'cf.site_sync_failed', siteId: site.id, err: { message: msg } },
        'cf site sync failed',
      );
    }
    return summary;
  },

  /** Iterate every active site with CF coordinates configured. */
  async syncAll(deps: CfServiceDeps, token: string): Promise<CfSyncSummary[]> {
    const all = await siteRepo.list(deps.db, { limit: 100, filters: { status: 'active' } });
    const eligible = all.items.filter((s) => s.cfAccountId && s.cfPagesProject);
    const out: CfSyncSummary[] = [];
    for (const site of eligible) {
      const summary = await this.syncSite(deps, token, site);
      out.push(summary);
    }
    deps.logger?.info({ event: 'cf.sync_all', sites: eligible.length }, 'cf bulk sync finished');
    return out;
  },
};
