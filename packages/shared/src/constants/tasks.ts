/**
 * Canonical task-queue enums + state machine.
 *
 * Mirrored in `@siteops/db` schema CHECK constraints; drift is guarded by
 * `packages/db/src/schema/__tests__/constants-drift.test.ts`.
 */

export const TASK_STATUS = [
  'queued',
  'claimed',
  'succeeded',
  'failed',
  'cancelled',
  'expired',
] as const;
export type TaskStatus = (typeof TASK_STATUS)[number];

export const TERMINAL_TASK_STATUSES = ['succeeded', 'failed', 'cancelled', 'expired'] as const;
export type TerminalTaskStatus = (typeof TERMINAL_TASK_STATUSES)[number];

export function isTerminalTaskStatus(s: TaskStatus): s is TerminalTaskStatus {
  return (TERMINAL_TASK_STATUSES as readonly string[]).includes(s);
}

/**
 * Legal forward transitions for the task state machine. See `tasks/T25-task-queue-api.md`
 * §"状态机" for the full diagram.
 *
 *   queued    → claimed, cancelled
 *   claimed   → succeeded, failed, queued (requeue on fail w/ retry), expired, cancelled
 *   succeeded → (terminal)
 *   failed    → (terminal)
 *   cancelled → (terminal)
 *   expired   → (terminal)
 */
export const TASK_STATE_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  queued: ['claimed', 'cancelled'],
  claimed: ['succeeded', 'failed', 'queued', 'expired', 'cancelled'],
  succeeded: [],
  failed: [],
  cancelled: [],
  expired: [],
};

export function canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_STATE_TRANSITIONS[from].includes(to);
}

/**
 * Allowed `kind` shape: lowercase + digits + dot/dash/underscore separators.
 * Examples: `content.draft`, `audit.run`, `deployment.trigger`.
 *
 * Not enum-checked — kinds evolve as Agents do — but a known list lives below
 * for dashboard autocomplete and documentation. Add to it as new kinds ship.
 */
export const TASK_KIND_REGEX = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
export const TASK_KIND_MAX_LENGTH = 64;

export const KNOWN_TASK_KINDS = [
  'content.draft',
  'audit.run',
  'deployment.trigger',
  'sync.cloudflare',
  'sync.github',
] as const;

export const TASK_PRIORITY_MIN = -100;
export const TASK_PRIORITY_MAX = 100;
export const TASK_MAX_ATTEMPTS_MIN = 1;
export const TASK_MAX_ATTEMPTS_MAX = 10;
export const TASK_DEFAULT_MAX_ATTEMPTS = 3;
export const TASK_DEDUPE_KEY_MAX_LENGTH = 200;

export const TASK_LEASE_SECONDS_MIN = 1;
export const TASK_LEASE_SECONDS_MAX = 600;
export const TASK_LEASE_SECONDS_DEFAULT = 60;

/**
 * Backoff schedule for failed-but-retried tasks (and claim-expired requeues):
 *   `available_at = now() + 30s * 2^(attempts-1)`, capped at 1 hour.
 *
 * Returns the delay in **milliseconds** so callers can pass straight to a Date.
 */
export const TASK_BACKOFF_BASE_MS = 30_000;
export const TASK_BACKOFF_MAX_MS = 60 * 60 * 1000;

export function computeTaskBackoffMs(attempts: number): number {
  const safe = Math.max(1, attempts);
  const ms = TASK_BACKOFF_BASE_MS * Math.pow(2, safe - 1);
  return Math.min(TASK_BACKOFF_MAX_MS, ms);
}
