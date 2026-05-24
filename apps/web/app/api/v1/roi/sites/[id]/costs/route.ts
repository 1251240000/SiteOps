import { type NextRequest } from 'next/server';

import { roi as roiSvc } from '@siteops/services';
import { AppError, siteIdParamSchema } from '@siteops/shared';

import { getDb } from '@/lib/db';
import { ok, withAuth } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/roi/sites/{id}/costs — list cost rows for a site (newest first).
 */
export function GET(req: NextRequest, routeCtx: RouteContext) {
  return withAuth(
    async (_request, ctx) => {
      const { id } = await routeCtx.params;
      const idParse = siteIdParamSchema.safeParse({ id });
      if (!idParse.success) {
        throw new AppError('Invalid site id', {
          code: 'validation_failed',
          status: 400,
          details: idParse.error.flatten(),
        });
      }
      void ctx;
      const rows = await roiSvc.roiService.listSiteCosts({ db: getDb() }, idParse.data.id);
      return ok(rows);
    },
    { scopes: ['metrics:read'] },
  )(req);
}

/**
 * POST /api/v1/roi/sites/{id}/costs — create a monthly cost row.
 *
 * Validation lives in the service so the same input contract applies
 * regardless of caller (HTTP, worker, agent). Duplicate (site, month)
 * pairs return a 409.
 */
export function POST(req: NextRequest, routeCtx: RouteContext) {
  return withAuth(
    async (request, ctx) => {
      const { id } = await routeCtx.params;
      const idParse = siteIdParamSchema.safeParse({ id });
      if (!idParse.success) {
        throw new AppError('Invalid site id', {
          code: 'validation_failed',
          status: 400,
          details: idParse.error.flatten(),
        });
      }
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        throw new AppError('Invalid JSON body', { code: 'validation_failed', status: 400 });
      }
      const created = await roiSvc.roiService.createSiteCost(
        { db: getDb(), logger: ctx.logger },
        idParse.data.id,
        body,
      );
      return ok(created, { status: 201 });
    },
    { scopes: ['metrics:write'], permission: 'roi.write' },
  )(req);
}
