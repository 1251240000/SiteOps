/**
 * GitHub integration service. Mirrors `cf-service`; ingests workflow_runs as
 * deployments and tracks per-site sync state in `integrations_state`.
 */

import { integrationStateRepo, siteRepo, type Db, type Site } from '@siteops/db';
import { github } from '@siteops/integrations';
import type { Logger } from '@siteops/shared';

import { deploymentService } from '../deployments/index.js';

export type GhServiceDeps = {
  db: Db;
  logger?: Pick<Logger, 'info' | 'warn' | 'error'>;
  clientFactory?: (token: string) => github.GitHubClient;
};

export type GhSyncSummary = {
  siteId: string;
  repo: string;
  fetched: number;
  inserted: number;
  updated: number;
  error?: string;
};

const PROVIDER = 'github' as const;

function defaultClient(token: string): github.GitHubClient {
  return new github.GitHubClient({ token });
}

export const ghService = {
  async verifyToken(deps: GhServiceDeps, token: string): Promise<{ login: string; id: number }> {
    const client = (deps.clientFactory ?? defaultClient)(token);
    return client.verifyToken();
  },

  async syncSite(
    deps: GhServiceDeps,
    token: string,
    site: Pick<Site, 'id' | 'repoUrl'>,
    options: { sinceFallbackDays?: number } = {},
  ): Promise<GhSyncSummary> {
    const repo = github.parseRepoUrl(site.repoUrl ?? undefined);
    if (!repo) throw new Error('ghService.syncSite: cannot parse repoUrl');
    const state = await integrationStateRepo.get(deps.db, PROVIDER, site.id);
    const sinceFallbackDays = options.sinceFallbackDays ?? 14;
    const fallback = new Date(Date.now() - sinceFallbackDays * 24 * 60 * 60 * 1000);
    const since = state?.lastSyncedAt ?? fallback;
    const summary: GhSyncSummary = {
      siteId: site.id,
      repo: `${repo.owner}/${repo.repo}`,
      fetched: 0,
      inserted: 0,
      updated: 0,
    };
    try {
      const client = (deps.clientFactory ?? defaultClient)(token);
      const runs = await client.listWorkflowRuns(repo.owner, repo.repo, { since, perPage: 50 });
      summary.fetched = runs.length;
      for (const run of runs) {
        const norm = github.workflowRunToDeployment(run);
        const result = await deploymentService.create(
          { db: deps.db, ...(deps.logger ? { logger: deps.logger } : {}) },
          {
            siteId: site.id,
            provider: norm.provider,
            providerDeploymentId: norm.providerDeploymentId,
            ...(norm.commitSha ? { commitSha: norm.commitSha } : {}),
            ...(norm.commitMessage ? { commitMessage: norm.commitMessage } : {}),
            ...(norm.branch ? { branch: norm.branch } : {}),
            status: norm.status,
            ...(norm.startedAt ? { startedAt: norm.startedAt } : {}),
            ...(norm.finishedAt ? { finishedAt: norm.finishedAt } : {}),
            buildLogUrl: norm.buildLogUrl,
            triggeredBy: 'git_push',
          },
        );
        if (result.created) summary.inserted += 1;
        else summary.updated += 1;
      }
      await integrationStateRepo.markSuccess(deps.db, PROVIDER, site.id);
      deps.logger?.info(
        {
          event: 'gh.site_sync',
          siteId: site.id,
          repo: summary.repo,
          fetched: summary.fetched,
        },
        'gh site sync done',
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      summary.error = msg;
      await integrationStateRepo.markError(deps.db, PROVIDER, site.id, msg);
      deps.logger?.warn(
        { event: 'gh.site_sync_failed', siteId: site.id, err: { message: msg } },
        'gh site sync failed',
      );
    }
    return summary;
  },

  async syncAll(deps: GhServiceDeps, token: string): Promise<GhSyncSummary[]> {
    const all = await siteRepo.list(deps.db, { limit: 100, filters: { status: 'active' } });
    const eligible = all.items.filter((s) => github.parseRepoUrl(s.repoUrl ?? undefined));
    const out: GhSyncSummary[] = [];
    for (const site of eligible) {
      const summary = await this.syncSite(deps, token, site);
      out.push(summary);
    }
    deps.logger?.info({ event: 'gh.sync_all', sites: eligible.length }, 'gh bulk sync finished');
    return out;
  },
};
