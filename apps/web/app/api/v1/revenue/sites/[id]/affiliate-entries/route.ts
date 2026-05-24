import { type NextRequest } from 'next/server';

import { revenue as revenueSvc } from '@siteops/services';
import { AppError, siteIdParamSchema } from '@siteops/shared';

import { getDb } from '@/lib/db';
import { ok, withAuth } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET  /api/v1/revenue/sites/{id}/affiliate-entries
 *
 * Lists the most recent affiliate entries for a site (newest first).
 * Range filtering happens server-side in the per-site page; the API just
 * returns the raw history.
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
      const rows = await revenueSvc.revenueService.listAffiliateEntries(
        { db: getDb() },
        idParse.data.id,
      );
      return ok(rows);
    },
    { scopes: ['metrics:read'] },
  )(req);
}

/**
 * POST /api/v1/revenue/sites/{id}/affiliate-entries
 *
 * Creates a new affiliate entry. Validation lives in the service so the
 * worker / agent can call the same path safely.
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
      const created = await revenueSvc.revenueService.createAffiliateEntry(
        { db: getDb(), logger: ctx.logger },
        idParse.data.id,
        body,
      );
      return ok(created, { status: 201 });
    },
    { scopes: ['metrics:write'], permission: 'revenue.write' },
  )(req);
}
