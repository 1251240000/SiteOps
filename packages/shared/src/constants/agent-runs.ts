/**
 * Canonical agent-run enums + autocomplete hints.
 *
 * `AGENT_RUN_STATUS` is mirrored in the DB schema's CHECK constraint and
 * the drift checker keeps them in lock-step.
 *
 * `KNOWN_AGENT_RUN_ACTIONS` is a free-text autocomplete hint surfaced by
 * the dashboard filter. New `action` strings can be introduced freely by
 * any `withApiKeyAudited` caller; this list only seeds the UI and
 * documents the existing ones.
 */

export const AGENT_RUN_STATUS = ['success', 'failed'] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUS)[number];

/**
 * Currently-emitted actions, by route surface. Keep grouped by noun so the
 * dashboard can render section headers if it ever wants to.
 */
export const KNOWN_AGENT_RUN_ACTIONS = [
  // errors API
  'errors.report',
  // task queue API (T25)
  'tasks.claim',
  'tasks.complete',
  'tasks.fail',
  'tasks.heartbeat',
  // future M5 / M6 surfaces — actually emit them by route migration, not here
  'deployments.report',
  'sites.update',
] as const;
export type KnownAgentRunAction = (typeof KNOWN_AGENT_RUN_ACTIONS)[number];

/** Maximum number of rows the summary endpoint will scan, as a safety net. */
export const AGENT_RUN_SUMMARY_MAX_RANGE_DAYS = 365;
/** Hard retention window — older rows are pruned by the housekeeping job. */
export const AGENT_RUN_RETENTION_DAYS = 90;
