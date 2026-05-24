import { type NextRequest } from 'next/server';

import { roi as roiSvc } from '@siteops/services';
import { AppError, idSchema } from '@siteops/shared';

import { getDb } from '@/lib/db';
import { ok, withAuth } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ costId: string }> };

async function readCostId(routeCtx: RouteContext): Promise<string> {
  const { costId } = await routeCtx.params;
  const parsed = idSchema.safeParse(costId);
  if (!parsed.success) {
    throw new AppError('Invalid cost id', { code: 'validation_failed', status: 400 });
  }
  return parsed.data;
}

/** GET /api/v1/roi/costs/{costId} — fetch a single row. */
export function GET(req: NextRequest, routeCtx: RouteContext) {
  return withAuth(
    async (_request, ctx) => {
      void ctx;
      const id = await readCostId(routeCtx);
      const row = await roiSvc.roiService.getSiteCost({ db: getDb() }, id);
      return ok(row);
    },
    { scopes: ['metrics:read'] },
  )(req);
}

/** PATCH /api/v1/roi/costs/{costId} — partial update. */
export function PATCH(req: NextRequest, routeCtx: RouteContext) {
  return withAuth(
    async (request, ctx) => {
      const id = await readCostId(routeCtx);
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        throw new AppError('Invalid JSON body', { code: 'validation_failed', status: 400 });
      }
      const updated = await roiSvc.roiService.updateSiteCost(
        { db: getDb(), logger: ctx.logger },
        id,
        body,
      );
      return ok(updated);
    },
    { scopes: ['metrics:write'], permission: 'roi.write' },
  )(req);
}

/** DELETE /api/v1/roi/costs/{costId} — remove. */
export function DELETE(req: NextRequest, routeCtx: RouteContext) {
  return withAuth(
    async (_request, ctx) => {
      const id = await readCostId(routeCtx);
      await roiSvc.roiService.deleteSiteCost({ db: getDb(), logger: ctx.logger }, id);
      return ok({ id });
    },
    { scopes: ['metrics:write'], permission: 'roi.write' },
  )(req);
}
