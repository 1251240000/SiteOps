import { type NextRequest } from 'next/server';

import { alertRepo } from '@siteops/db';
import { AppError, idSchema } from '@siteops/shared';

import { getDb } from '@/lib/db';
import { ok, withApi } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/alerts/{id}/ack — manually mark an alert resolved.
 * Useful when a notification was sent but the underlying check is now
 * passing and we want to clear the dashboard.
 */
export function POST(req: NextRequest, routeCtx: RouteContext) {
  return withApi(async (_req, _ctx) => {
    const { id } = await routeCtx.params;
    const parsed = idSchema.safeParse(id);
    if (!parsed.success) {
      throw new AppError('Invalid alert id', { code: 'validation_failed', status: 400 });
    }
    const row = await alertRepo.resolveAlert(getDb(), parsed.data);
    if (!row) {
      throw new AppError('Alert not found', { code: 'not_found', status: 404 });
    }
    return ok(row);
  })(req);
}
