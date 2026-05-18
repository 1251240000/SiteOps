/**
 * GitHub → `deploymentService` adapter.
 *
 * We handle three event flavours:
 *   - `workflow_run`     → deployment row keyed by `gh-${run.id}`
 *   - `deployment_status`→ deployment row keyed by `gh-deploy-${deployment.id}`
 *   - `push`             → recorded only (not every push is a deploy)
 *
 * The `provider` field is `github_pages` for runs whose workflow name maps
 * to GH Pages; anything else gets `manual`. The mapping logic is delegated
 * to `@siteops/integrations/github` so cron + webhook stay aligned.
 */
import { siteRepo } from '@siteops/db';
import { github } from '@siteops/integrations';
import {
  githubDeploymentStatusPayloadSchema,
  githubPushPayloadSchema,
  githubWorkflowRunPayloadSchema,
  type CreateDeploymentInput,
  type DeploymentStatus,
  type GithubEventType,
} from '@siteops/shared';

import { deploymentService, type DeploymentServiceDeps } from '../deployments/index.js';

export type GithubDispatchResult = {
  siteId: string | null;
  inserted: boolean;
  /** `null` for `push` / `ping` deliveries that intentionally don't create a deployment. */
  deploymentId: string | null;
};

const SKIP: GithubDispatchResult = { siteId: null, inserted: false, deploymentId: null };

function ownerRepoFromFullName(fullName: string | null | undefined): string | null {
  if (!fullName) return null;
  const m = fullName.match(/^([^\s/]+\/[^\s/]+)$/);
  return m ? m[1]! : null;
}

/** Map GitHub deployment_status state strings → canonical DeploymentStatus. */
function mapDeploymentStatusState(state: string): DeploymentStatus {
  switch (state.toLowerCase()) {
    case 'success':
      return 'success';
    case 'failure':
    case 'error':
      return 'failed';
    case 'pending':
    case 'queued':
      return 'queued';
    case 'in_progress':
      return 'building';
    case 'inactive':
      return 'cancelled';
    default:
      return 'failed';
  }
}

export async function dispatchGithub(
  deps: DeploymentServiceDeps,
  eventType: GithubEventType,
  payloadRaw: Record<string, unknown>,
): Promise<GithubDispatchResult> {
  if (eventType === 'ping') return SKIP;

  if (eventType === 'push') {
    // We deliberately don't create a deployment row on `push` — it's logged
    // as a `webhook_event` (handled at the service layer) but not surfaced
    // on the deployment timeline. Still resolve a `site_id` so the audit
    // row is queryable per-site.
    const payload = githubPushPayloadSchema.parse(payloadRaw);
    const ownerRepo = ownerRepoFromFullName(payload.repository.full_name);
    const site = ownerRepo ? await siteRepo.findByGithubRepo(deps.db, ownerRepo) : null;
    return { siteId: site?.id ?? null, inserted: false, deploymentId: null };
  }

  if (eventType === 'deployment_status') {
    const payload = githubDeploymentStatusPayloadSchema.parse(payloadRaw);
    const ownerRepo = ownerRepoFromFullName(payload.repository.full_name);
    const site = ownerRepo ? await siteRepo.findByGithubRepo(deps.db, ownerRepo) : null;
    if (!site) return SKIP;

    const status = mapDeploymentStatusState(payload.deployment_status.state);
    const finishedAt = payload.deployment_status.updated_at;
    const buildLogUrl =
      payload.deployment_status.log_url ??
      payload.deployment_status.target_url ??
      payload.deployment_status.environment_url ??
      undefined;

    const input: CreateDeploymentInput = {
      siteId: site.id,
      provider: 'github_pages',
      providerDeploymentId: `gh-deploy-${payload.deployment.id}`,
      status,
      triggeredBy: 'git_push',
      ...(payload.deployment.sha ? { commitSha: payload.deployment.sha } : {}),
      ...(payload.deployment.ref ? { branch: payload.deployment.ref } : {}),
      ...(buildLogUrl ? { buildLogUrl } : {}),
      ...(finishedAt && (status === 'success' || status === 'failed' || status === 'cancelled')
        ? { finishedAt }
        : {}),
    };
    const result = await deploymentService.create(deps, input);
    return {
      siteId: site.id,
      inserted: result.created,
      deploymentId: result.deployment.id,
    };
  }

  // eventType === 'workflow_run'
  const payload = githubWorkflowRunPayloadSchema.parse(payloadRaw);
  const ownerRepo = ownerRepoFromFullName(payload.repository.full_name);
  const site = ownerRepo ? await siteRepo.findByGithubRepo(deps.db, ownerRepo) : null;
  if (!site) return SKIP;

  // Reuse the same mapper the cron job uses so cron + webhook converge.
  const mapped = github.workflowRunToDeployment(payload.workflow_run as never);
  if (mapped.status === 'queued') {
    // T27 spec says we only dispatch in_progress → building / completed →
    // success|failed. Queued runs are dropped on the floor (no row created).
    return { siteId: site.id, inserted: false, deploymentId: null };
  }

  const input: CreateDeploymentInput = {
    siteId: site.id,
    provider: mapped.provider,
    providerDeploymentId: mapped.providerDeploymentId,
    status: mapped.status,
    triggeredBy: 'git_push',
    ...(mapped.commitSha ? { commitSha: mapped.commitSha } : {}),
    ...(mapped.commitMessage ? { commitMessage: mapped.commitMessage } : {}),
    ...(mapped.branch ? { branch: mapped.branch } : {}),
    ...(mapped.startedAt ? { startedAt: mapped.startedAt } : {}),
    ...(mapped.finishedAt ? { finishedAt: mapped.finishedAt } : {}),
    buildLogUrl: mapped.buildLogUrl,
  };

  const result = await deploymentService.create(deps, input);
  return {
    siteId: site.id,
    inserted: result.created,
    deploymentId: result.deployment.id,
  };
}
