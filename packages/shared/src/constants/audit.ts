/**
 * Audit / finding enums. Mirrored in `@siteops/db` schema; drift is
 * guarded by the db package's `constants-drift.test.ts`.
 */

export const AUDIT_TYPES = ['seo', 'lighthouse', 'links', 'compliance'] as const;
export type AuditType = (typeof AUDIT_TYPES)[number];

export const AUDIT_STATUS = ['running', 'success', 'failed'] as const;
export type AuditStatus = (typeof AUDIT_STATUS)[number];

export const FINDING_SEVERITY = ['info', 'warning', 'error', 'critical'] as const;
export type FindingSeverity = (typeof FINDING_SEVERITY)[number];

/** Ordered low → high; useful for filtering and rendering. */
export const FINDING_SEVERITY_ORDER: Record<FindingSeverity, number> = {
  info: 0,
  warning: 1,
  error: 2,
  critical: 3,
};
