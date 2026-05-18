/**
 * Canonical list of API-key scopes used by `authService.checkScopes` and
 * the API-keys management UI.
 *
 * Adding a scope is a three-step job:
 *   1. Append it here.
 *   2. Reference it in the relevant `withApiKey(..., { scopes: [...] })`.
 *   3. Expose a label string under `pages.apiKeys.scopes.<key>` in i18n.
 */
export const API_KEY_SCOPES = [
  'sites:read',
  'sites:write',
  'deployments:write',
  'errors:read',
  'errors:write',
  'tasks:read',
  'tasks:write',
  'tasks:claim',
  'agent-runs:read',
] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

/** `*` grants all scopes. UI never lets the admin create a `*` key
 * implicitly — must be the *only* scope chosen, and emits a warning toast. */
export const API_KEY_WILDCARD = '*';

/** Hard cap on how many active (non-revoked) keys we allow per account.
 * Single-admin product → 50 is luxurious. */
export const API_KEY_MAX_ACTIVE = 50;
