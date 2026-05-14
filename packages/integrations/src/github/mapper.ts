/**
 * Convert a GitHub workflow_run into a deployment-shaped object that the
 * deploymentService can upsert.
 *
 * The mapping is intentionally lossy: we record one row per workflow_run and
 * key it by `(github_pages, ${run.id})` so re-fetches stay idempotent. The
 * "is this actually a deploy?" distinction is policy — for Pages builds the
 * workflow is named `pages build and deployment`; everything else is treated
 * as a `manual` deployment record so it still shows up on the timeline.
 */

import type { GhWorkflowRun } from './types.js';

export type GhMappedStatus = 'queued' | 'building' | 'success' | 'failed' | 'cancelled';

export function mapWorkflowRunStatus(run: GhWorkflowRun): GhMappedStatus {
  if (run.status === 'completed') {
    switch (run.conclusion) {
      case 'success':
        return 'success';
      case 'cancelled':
      case 'skipped':
      case 'stale':
        return 'cancelled';
      case 'failure':
      case 'timed_out':
      case 'startup_failure':
      case 'action_required':
        return 'failed';
      case 'neutral':
        return 'success';
      default:
        return 'failed';
    }
  }
  if (run.status === 'in_progress') return 'building';
  return 'queued';
}

export type GhDeploymentMapping = {
  provider: 'github_pages' | 'manual';
  providerDeploymentId: string;
  status: GhMappedStatus;
  commitSha?: string;
  commitMessage?: string;
  branch?: string;
  startedAt?: string;
  finishedAt?: string;
  buildLogUrl: string;
};

const PAGES_PATTERNS = [/^pages build and deployment$/i, /pages-build-deployment\.ya?ml$/i];

function isPagesDeployment(run: GhWorkflowRun): boolean {
  const name = (run.name ?? '').toLowerCase();
  if (PAGES_PATTERNS.some((re) => re.test(name))) return true;
  const path = run.path ?? '';
  return PAGES_PATTERNS.some((re) => re.test(path));
}

export function workflowRunToDeployment(run: GhWorkflowRun): GhDeploymentMapping {
  const status = mapWorkflowRunStatus(run);
  const provider: 'github_pages' | 'manual' = isPagesDeployment(run) ? 'github_pages' : 'manual';
  const out: GhDeploymentMapping = {
    provider,
    providerDeploymentId: `gh-${run.id}`,
    status,
    buildLogUrl: run.html_url,
  };
  if (run.head_sha) out.commitSha = run.head_sha;
  if (run.head_commit?.message) out.commitMessage = run.head_commit.message;
  if (run.head_branch) out.branch = run.head_branch;
  if (run.run_started_at ?? run.created_at) {
    out.startedAt = run.run_started_at ?? run.created_at;
  }
  if (status === 'success' || status === 'failed' || status === 'cancelled') {
    out.finishedAt = run.updated_at;
  }
  return out;
}
