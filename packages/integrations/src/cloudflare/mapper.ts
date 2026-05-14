/**
 * Convert Cloudflare deployment payloads into the canonical
 * `CreateDeploymentInput` shape consumed by `deploymentService.create`.
 *
 * The mapping is intentionally tolerant: CF occasionally returns a stage
 * named `deploy` whose `status: 'success'` is the only signal the build is
 * done, so we walk every stage and pick the strongest verdict.
 */

import type { CfPagesDeployment } from './types.js';

export type CfDeploymentStatus = 'queued' | 'building' | 'success' | 'failed' | 'cancelled';

const SUCCESS_STAGE_STATES = new Set(['success']);
const FAILED_STAGE_STATES = new Set(['failure', 'failed']);
const CANCELLED_STAGE_STATES = new Set(['canceled', 'cancelled', 'skipped']);
const BUILDING_STAGE_STATES = new Set(['active', 'building']);

export function mapDeploymentStatus(d: CfPagesDeployment): CfDeploymentStatus {
  // Prefer the latest_stage shorthand when present.
  const latest = d.latest_stage?.status?.toLowerCase();
  if (latest && FAILED_STAGE_STATES.has(latest)) return 'failed';
  if (latest && CANCELLED_STAGE_STATES.has(latest)) return 'cancelled';

  const stages = d.stages ?? [];
  // Look for the final "deploy" stage explicitly — CF marks the deployment
  // successful only when that stage hits `success`.
  const deployStage = stages.find((s) => s.name === 'deploy');
  if (deployStage) {
    const st = deployStage.status?.toLowerCase();
    if (st && SUCCESS_STAGE_STATES.has(st)) return 'success';
    if (st && FAILED_STAGE_STATES.has(st)) return 'failed';
    if (st && CANCELLED_STAGE_STATES.has(st)) return 'cancelled';
    if (st && BUILDING_STAGE_STATES.has(st)) return 'building';
  }

  for (const s of stages) {
    const st = s.status?.toLowerCase();
    if (st && FAILED_STAGE_STATES.has(st)) return 'failed';
    if (st && CANCELLED_STAGE_STATES.has(st)) return 'cancelled';
  }

  if (latest && SUCCESS_STAGE_STATES.has(latest)) return 'success';
  if (latest && BUILDING_STAGE_STATES.has(latest)) return 'building';
  if (stages.some((s) => BUILDING_STAGE_STATES.has((s.status ?? '').toLowerCase()))) {
    return 'building';
  }
  return 'queued';
}

export type NormalizedDeployment = {
  providerDeploymentId: string;
  status: CfDeploymentStatus;
  commitSha?: string;
  commitMessage?: string;
  branch?: string;
  startedAt?: string;
  finishedAt?: string;
  buildLogUrl?: string;
};

export function normalizeDeployment(d: CfPagesDeployment): NormalizedDeployment {
  const status = mapDeploymentStatus(d);
  const stages = d.stages ?? [];
  const buildStage = stages.find((s) => s.name === 'build');
  const deployStage = stages.find((s) => s.name === 'deploy');
  const startedAt = buildStage?.started_on ?? stages[0]?.started_on ?? undefined;
  const finishedAt = deployStage?.ended_on ?? stages.at(-1)?.ended_on ?? undefined;
  const meta = d.deployment_trigger?.metadata ?? {};
  const out: NormalizedDeployment = {
    providerDeploymentId: d.id,
    status,
  };
  if (meta.commit_hash) out.commitSha = meta.commit_hash;
  if (meta.commit_message) out.commitMessage = meta.commit_message;
  if (meta.branch) out.branch = meta.branch;
  if (startedAt) out.startedAt = startedAt;
  if (finishedAt && (status === 'success' || status === 'failed' || status === 'cancelled')) {
    out.finishedAt = finishedAt;
  }
  if (d.url) out.buildLogUrl = d.url;
  return out;
}
