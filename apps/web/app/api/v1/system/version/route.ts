/**
 * `GET /api/v1/system/version` — admin diagnostic endpoint (T38).
 *
 * Returns the running build's metadata so operators can confirm a deploy
 * landed on a given replica. Never includes secrets; safe to surface in
 * the dashboard or paste into an incident ticket.
 *
 * Fields:
 *   - `version`     `package.json#version` (set by pnpm/npm when invoking the script).
 *   - `gitSha`      Build-time `GIT_SHA` env var, injected by the release
 *                   pipeline (`docker build --build-arg GIT_SHA=...`); `null`
 *                   in dev / when not provided.
 *   - `nodeVersion` Process Node runtime, e.g. `v20.16.0`.
 *   - `startedAt`   ISO 8601 timestamp stamped by `instrumentation.ts` on
 *                   server boot. `null` when the hook never ran (e.g. tests
 *                   that import the route directly without booting Next).
 *
 * Auth: requires an admin session. Bearer keys deliberately rejected — the
 * field set is small, but mixing it with the public API surface invites
 * downstream agents from probing the version to choose exploits.
 */
import { ok, withApi } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

export type SystemVersion = {
  version: string;
  gitSha: string | null;
  nodeVersion: string;
  startedAt: string | null;
};

export const GET = withApi(async () =>
  ok<SystemVersion>({
    version: process.env['npm_package_version'] ?? '0.0.0',
    gitSha: process.env['GIT_SHA'] ?? null,
    nodeVersion: process.version,
    startedAt: process.env['BOOTED_AT'] ?? null,
  }),
);
