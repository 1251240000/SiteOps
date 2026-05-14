import { type NextRequest } from 'next/server';

import { errorTracking as errSvc } from '@siteops/services';
import { AppError, idSchema, updateErrorSchema } from '@siteops/shared';

import { getDb } from '@/lib/db';
import { ok, withAuth } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

function readId(routeCtx: RouteContext): Promise<string> {
  return routeCtx.params.then(({ id }) => {
    const parsed = idSchema.safeParse(id);
    if (!parsed.success) {
      throw new AppError('Invalid error id', { code: 'validation_failed', status: 400 });
    }
    return parsed.data;
  });
}

export function GET(req: NextRequest, routeCtx: RouteContext) {
  return withAuth(
    async (_req, apiCtx) => {
      const id = await readId(routeCtx);
      const row = await errSvc.errorTrackingService.getById(
        { db: getDb(), logger: apiCtx.logger },
        id,
      );
      return ok(row);
    },
    { scopes: ['errors:read'] },
  )(req);
}

export function PATCH(req: NextRequest, routeCtx: RouteContext) {
  return withAuth(
    async (request, apiCtx) => {
      const id = await readId(routeCtx);
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        throw new AppError('Invalid JSON body', { code: 'validation_failed', status: 400 });
      }
      const parsed = updateErrorSchema.safeParse(body);
      if (!parsed.success) {
        throw new AppError('Invalid request body', {
          code: 'validation_failed',
          status: 400,
          details: parsed.error.flatten(),
        });
      }
      const row = await errSvc.errorTrackingService.update(
        { db: getDb(), logger: apiCtx.logger },
        id,
        parsed.data,
      );
      return ok(row);
    },
    { scopes: ['errors:write'] },
  )(req);
}

export function DELETE(req: NextRequest, routeCtx: RouteContext) {
  return withAuth(
    async (_req, apiCtx) => {
      const id = await readId(routeCtx);
      const row = await errSvc.errorTrackingService.softDelete(
        { db: getDb(), logger: apiCtx.logger },
        id,
      );
      return ok(row);
    },
    { scopes: ['errors:write'] },
  )(req);
}
