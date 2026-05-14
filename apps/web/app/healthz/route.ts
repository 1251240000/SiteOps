import { NextResponse } from 'next/server';

/**
 * Liveness probe. Intentionally stays out of `/api/v1` (per docs/04-api-spec)
 * and does not touch the DB so it can still return 200 during DB outages —
 * readiness lives at `/readyz` (added in T07 when the dashboard shell exists).
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ status: 'ok', service: 'web' });
}
