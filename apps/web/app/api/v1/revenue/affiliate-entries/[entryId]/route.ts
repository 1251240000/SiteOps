import { type NextRequest } from 'next/server';

import { revenue as revenueSvc } from '@siteops/services';
import { AppError, idSchema } from '@siteops/shared';

import { getDb } from '@/lib/db';
import { ok, withAuth } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ entryId: string }> };

async function readEntryId(routeCtx: RouteContext): Promise<string> {
  const { entryId } = await routeCtx.params;
  const parsed = idSchema.safeParse(entryId);
  if (!parsed.success) {
    throw new AppError('Invalid entry id', { code: 'validation_failed', status: 400 });
  }
  return parsed.data;
}

/** GET /api/v1/revenue/affiliate-entries/{entryId} — fetch one entry. */
export function GET(req: NextRequest, routeCtx: RouteContext) {
  return withAuth(
    async (_request, ctx) => {
      const id = await readEntryId(routeCtx);
      void ctx;
      const row = await revenueSvc.revenueService.getAffiliateEntry({ db: getDb() }, id);
      return ok(row);
    },
    { scopes: ['metrics:read'] },
  )(req);
}

/** PATCH /api/v1/revenue/affiliate-entries/{entryId} — partial update. */
export function PATCH(req: NextRequest, routeCtx: RouteContext) {
  return withAuth(
    async (request, ctx) => {
      const id = await readEntryId(routeCtx);
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        throw new AppError('Invalid JSON body', { code: 'validation_failed', status: 400 });
      }
      const updated = await revenueSvc.revenueService.updateAffiliateEntry(
        { db: getDb(), logger: ctx.logger },
        id,
        body,
      );
      return ok(updated);
    },
    { scopes: ['metrics:write'], permission: 'revenue.write' },
  )(req);
}

/** DELETE /api/v1/revenue/affiliate-entries/{entryId} — remove. */
export function DELETE(req: NextRequest, routeCtx: RouteContext) {
  return withAuth(
    async (_request, ctx) => {
      const id = await readEntryId(routeCtx);
      await revenueSvc.revenueService.deleteAffiliateEntry({ db: getDb(), logger: ctx.logger }, id);
      return ok({ id });
    },
    { scopes: ['metrics:write'], permission: 'revenue.write' },
  )(req);
}
