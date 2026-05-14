import { type NextRequest } from 'next/server';

import { audits as auditsSvc } from '@siteops/services';
import { AppError, idSchema } from '@siteops/shared';

import { getDb } from '@/lib/db';
import { ok, withAuth } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/v1/audits/{id} — single audit run. */
export function GET(req: NextRequest, routeCtx: RouteContext) {
  return withAuth(
    async (_req, apiCtx) => {
      const { id } = await routeCtx.params;
      const parsed = idSchema.safeParse(id);
      if (!parsed.success) {
        throw new AppError('Invalid audit id', { code: 'validation_failed', status: 400 });
      }
      const row = await auditsSvc.auditService.getRun(
        { db: getDb(), logger: apiCtx.logger },
        parsed.data,
      );
      return ok(row);
    },
    { scopes: ['audits:read'] },
  )(req);
}
