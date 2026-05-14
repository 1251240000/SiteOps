/**
 * Canonical deployment enums. Mirrored in the `@siteops/db` schema CHECK
 * constraints; drift is guarded by `packages/db/src/schema/__tests__/constants-drift.test.ts`.
 */

export const DEPLOYMENT_PROVIDERS = [
  'cloudflare_pages',
  'github_pages',
  'vercel',
  'netlify',
  'manual',
] as const;
export type DeploymentProvider = (typeof DEPLOYMENT_PROVIDERS)[number];

export const DEPLOYMENT_STATUS = ['queued', 'building', 'success', 'failed', 'cancelled'] as const;
export type DeploymentStatus = (typeof DEPLOYMENT_STATUS)[number];

export const DEPLOYMENT_TRIGGERS = ['human', 'git_push', 'agent', 'schedule'] as const;
export type DeploymentTrigger = (typeof DEPLOYMENT_TRIGGERS)[number];

/**
 * Legal forward transitions for the deployment status machine.
 *
 *   queued    → building, cancelled, failed
 *   building  → success, failed, cancelled
 *   success   → (terminal)
 *   failed    → (terminal)
 *   cancelled → (terminal)
 *
 * The reverse is never allowed — once a deploy is terminal, a re-POST with a
 * different status is rejected by `deploymentService` with `conflict`.
 *
 * Lateral re-asserts of the same status are silently accepted so retries of
 * a webhook don't bounce.
 */
export const DEPLOYMENT_STATE_TRANSITIONS: Readonly<
  Record<DeploymentStatus, readonly DeploymentStatus[]>
> = {
  queued: ['queued', 'building', 'failed', 'cancelled'],
  building: ['building', 'success', 'failed', 'cancelled'],
  success: ['success'],
  failed: ['failed'],
  cancelled: ['cancelled'],
};

/**
 * `true` iff a transition from `from` to `to` is permitted by the state
 * machine above. Used by both the service layer (enforcement) and the UI
 * (to grey out impossible status mutations).
 */
export function canTransitionDeployment(from: DeploymentStatus, to: DeploymentStatus): boolean {
  return DEPLOYMENT_STATE_TRANSITIONS[from].includes(to);
}

export const TERMINAL_DEPLOYMENT_STATUSES = ['success', 'failed', 'cancelled'] as const;
export type TerminalDeploymentStatus = (typeof TERMINAL_DEPLOYMENT_STATUSES)[number];

export function isTerminalDeploymentStatus(s: DeploymentStatus): s is TerminalDeploymentStatus {
  return TERMINAL_DEPLOYMENT_STATUSES.includes(s as TerminalDeploymentStatus);
}
