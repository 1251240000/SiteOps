import { NextResponse } from 'next/server';

import { pingDb } from '@siteops/db';

import { getDb } from '@/lib/db';
import { getLogger } from '@/lib/logger';
import { getRedis } from '@/lib/redis';

/**
 * Readiness probe (T29).
 *
 * `/healthz` is liveness — answers 200 as long as the Node process is alive.
 * `/readyz` adds dependency checks:
 *   - DB:    one `SELECT 1` round-trip via `pingDb`
 *   - Redis: one `PING`
 *
 * Each check has a hard 1s timeout. Any failure or timeout flips the response
 * to HTTP 503 with `status: 'degraded'`, which Caddy's `health_uri /readyz`
 * uses to take this upstream out of rotation. Docker's container-level
 * `HEALTHCHECK` keeps using `/healthz` so a transient DB outage doesn't trip
 * the restart loop.
 *
 * Logging is intentionally throttled to status transitions (ok ↔ degraded)
 * to avoid flooding the logs at the 10s probe cadence.
 */
export const dynamic = 'force-dynamic';

const TIMEOUT_MS = 1000;
const TIMEOUT = Symbol('readyz.timeout');

type CheckOutcome = 'ok' | 'fail';
type Status = 'ok' | 'degraded';

/** Module-scoped so log lines fire only on transitions, not every probe. */
let lastStatus: Status | undefined;

async function withTimeout<T>(promise: Promise<T>): Promise<T | typeof TIMEOUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMEOUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT), TIMEOUT_MS);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function checkDb(): Promise<CheckOutcome> {
  try {
    const result = await withTimeout(pingDb(getDb()));
    return result === TIMEOUT ? 'fail' : 'ok';
  } catch {
    return 'fail';
  }
}

async function checkRedis(): Promise<CheckOutcome> {
  try {
    const result = await withTimeout(getRedis().ping());
    return result === TIMEOUT ? 'fail' : 'ok';
  } catch {
    return 'fail';
  }
}

export async function GET(): Promise<NextResponse> {
  const [db, redis] = await Promise.all([checkDb(), checkRedis()]);
  const ok = db === 'ok' && redis === 'ok';
  const status: Status = ok ? 'ok' : 'degraded';

  if (status !== lastStatus) {
    const log = getLogger();
    if (status === 'degraded') {
      log.warn({ checks: { db, redis } }, 'readyz transition to degraded');
    } else {
      log.info({ checks: { db, redis } }, 'readyz transition to ok');
    }
    lastStatus = status;
  }

  return NextResponse.json({ status, checks: { db, redis } }, { status: ok ? 200 : 503 });
}

/** Test-only: clear the cached transition state so each test starts fresh. */
export function __resetReadyzStateForTests(): void {
  lastStatus = undefined;
}
