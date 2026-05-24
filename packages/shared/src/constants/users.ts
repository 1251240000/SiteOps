/**
 * User role constants and permission matrix for RBAC (T40).
 *
 * Three roles:
 *   - `admin`    — full access; manages users, settings, integrations.
 *   - `operator` — can create/edit sites, alerts, but cannot manage users.
 *   - `viewer`   — read-only across dashboards.
 */

export const USER_ROLES = ['admin', 'operator', 'viewer'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = ['active', 'suspended'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/**
 * Flat permission strings used in `requirePermission()` guards.
 *
 * Convention: `<resource>.<verb>` — mirrors the API-key scopes but covers
 * dashboard-only concepts too (e.g. `users.write`, `audit.read`).
 */
export const PERMISSIONS = [
  'sites.read',
  'sites.write',
  'alerts.read',
  'alerts.write',
  'api_keys.read',
  'api_keys.write',
  'audit.read',
  'users.read',
  'users.write',
  'metrics.read',
  'agent_runs.read',
  'webhooks.read',
  'webhooks.write',
  'deployments.read',
  'deployments.write',
  'domains.read',
  'domains.write',
  'errors.read',
  'errors.write',
  'integrations.read',
  'integrations.write',
  'tasks.read',
  'tasks.write',
  'revenue.read',
  'revenue.write',
  'settings.read',
  'settings.write',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/**
 * Permission matrix per role. `admin` gets a wildcard; other roles are
 * explicitly enumerated so new permissions default to "denied".
 */
export const ROLE_PERMISSIONS: Record<UserRole, Readonly<Record<string, boolean>>> = {
  admin: { '*': true },
  operator: {
    'sites.read': true,
    'sites.write': true,
    'alerts.read': true,
    'alerts.write': true,
    'api_keys.read': false,
    'api_keys.write': false,
    'audit.read': false,
    'users.read': false,
    'users.write': false,
    'metrics.read': true,
    'agent_runs.read': true,
    'webhooks.read': true,
    'webhooks.write': false,
    'deployments.read': true,
    'deployments.write': true,
    'domains.read': true,
    'domains.write': true,
    'errors.read': true,
    'errors.write': true,
    'integrations.read': true,
    'integrations.write': true,
    'tasks.read': true,
    'tasks.write': true,
    'revenue.read': true,
    'revenue.write': false,
    'settings.read': true,
    'settings.write': false,
  },
  viewer: {
    'sites.read': true,
    'sites.write': false,
    'alerts.read': true,
    'alerts.write': false,
    'api_keys.read': false,
    'api_keys.write': false,
    'audit.read': false,
    'users.read': false,
    'users.write': false,
    'metrics.read': true,
    'agent_runs.read': true,
    'webhooks.read': true,
    'webhooks.write': false,
    'deployments.read': true,
    'deployments.write': false,
    'domains.read': true,
    'domains.write': false,
    'errors.read': true,
    'errors.write': false,
    'integrations.read': true,
    'integrations.write': false,
    'tasks.read': true,
    'tasks.write': false,
    'revenue.read': true,
    'revenue.write': false,
    'settings.read': false,
    'settings.write': false,
  },
} as const;

/**
 * Check whether a role has a specific permission. Returns `false` for
 * unknown roles or unknown permission keys — never throws — so callers can
 * use this on user-supplied input (session payloads, API params).
 */
export function can(role: UserRole, perm: string): boolean {
  const map = ROLE_PERMISSIONS[role];
  if (!map) return false;
  return map['*'] === true || map[perm] === true;
}
