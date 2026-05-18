/**
 * Cloudflare Pages → `deploymentService` adapter.
 *
 * CF Notification webhooks deliver a flat JSON payload describing one of:
 *   - `deployment.started`  → status='building'
 *   - `deployment.success`  → status='success'
 *   - `deployment.failure`  → status='failed'
 *
 * We map those onto `CreateDeploymentInput` with `provider='cloudflare_pages'`
 * so the existing `(provider, provider_deployment_id)` unique index
 * idempotency handles double-delivery without our help.
 */
import { siteRepo } from '@siteops/db';
import {
  cloudflarePayloadSchema,
  type CloudflareEventType,
  type CreateDeploymentInput,
  type DeploymentStatus,
} from '@siteops/shared';

import { deploymentService, type DeploymentServiceDeps } from '../deployments/index.js';

const STATUS_BY_EVENT: Record<CloudflareEventType, DeploymentStatus> = {
  'deployment.started': 'building',
  'deployment.success': 'success',
  'deployment.failure': 'failed',
};

export type CloudflareDispatchResult = {
  /** `sites.id` resolved from the payload's `project_name`, or `null`. */
  siteId: string | null;
  /** `true` when `deploymentService.create` inserted a brand-new row. */
  inserted: boolean;
  /** Diagnostic — useful in tests / logs. */
  deploymentId: string;
};

/**
 * Build a deployment row out of a Cloudflare Notification payload.
 *
 * Returns `null` (skip dispatch) when the payload is too sparse to be
 * actionable — usually a malformed test ping. Callers should treat that
 * as `signature_ok=true / processed=false / error='unresolvable'`.
 */
export async function dispatchCloudflare(
  deps: DeploymentServiceDeps,
  eventType: CloudflareEventType,
  payloadRaw: Record<string, unknown>,
): Promise<CloudflareDispatchResult | null> {
  const payload = cloudflarePayloadSchema.parse(payloadRaw);
  const project = payload.project_name?.trim();
  if (!project) return null;

  const site = await siteRepo.findByCfPagesProject(deps.db, project);
  if (!site) return null;

  if (!payload.deployment_id) return null;

  const input: CreateDeploymentInput = {
    siteId: site.id,
    provider: 'cloudflare_pages',
    providerDeploymentId: payload.deployment_id,
    status: STATUS_BY_EVENT[eventType],
    triggeredBy: 'git_push',
    ...(payload.commit_hash ? { commitSha: payload.commit_hash } : {}),
    ...(payload.branch ? { branch: payload.branch } : {}),
    ...(payload.build_log_url ? { buildLogUrl: payload.build_log_url } : {}),
    ...(payload.started_at ? { startedAt: payload.started_at } : {}),
    ...(payload.finished_at ? { finishedAt: payload.finished_at } : {}),
  };

  const result = await deploymentService.create(deps, input);
  return {
    siteId: site.id,
    inserted: result.created,
    deploymentId: result.deployment.id,
  };
}
