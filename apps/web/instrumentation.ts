/**
 * Next 15 instrumentation hook.
 *
 * Runs exactly once per server start (both `next dev` and `next start`),
 * before any route handler executes. We use it to stamp `BOOTED_AT` —
 * read by `/api/v1/system/version` so operators can tell whether a
 * replica picked up a recent deploy.
 *
 * Intentionally avoids any heavy work (no DB / Redis here): instrumentation
 * runs in the request-handling process, and a slow boot hurts readiness.
 */
export async function register(): Promise<void> {
  if (!process.env['BOOTED_AT']) {
    process.env['BOOTED_AT'] = new Date().toISOString();
  }
}
