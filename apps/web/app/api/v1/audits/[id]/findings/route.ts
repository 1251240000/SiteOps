import { type NextRequest } from 'next/server';

import { audits as auditsSvc } from '@siteops/services';
import { AppError, idSchema } from '@siteops/shared';

import { getDb } from '@/lib/db';
import { ok, withAuth } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/v1/audits/{id}/findings — list findings for a single audit run. */
export function GET(req: NextRequest, routeCtx: RouteContext) {
  return withAuth(
    async (_req, apiCtx) => {
      const { id } = await routeCtx.params;
      const parsed = idSchema.safeParse(id);
      if (!parsed.success) {
        throw new AppError('Invalid audit id', { code: 'validation_failed', status: 400 });
      }
      const items = await auditsSvc.auditService.listFindings(
        { db: getDb(), logger: apiCtx.logger },
        parsed.data,
      );
      return ok(items, { meta: { auditRunId: parsed.data, total: items.length } });
    },
    { scopes: ['audits:read'] },
  )(req);
}
