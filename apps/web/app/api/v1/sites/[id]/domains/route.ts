import { type NextRequest } from 'next/server';

import { domains as domainSvc } from '@siteops/services';
import { AppError, createDomainSchema, siteIdParamSchema } from '@siteops/shared';

import { getDb } from '@/lib/db';
import { ok, withAuth } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

async function readSiteId(ctx: RouteContext): Promise<string> {
  const { id } = await ctx.params;
  const parsed = siteIdParamSchema.safeParse({ id });
  if (!parsed.success) {
    throw new AppError('Invalid site id', {
      code: 'validation_failed',
      status: 400,
      details: parsed.error.flatten(),
    });
  }
  return parsed.data.id;
}

/** GET /api/v1/sites/{id}/domains — convenience for the site detail page. */
export function GET(req: NextRequest, routeCtx: RouteContext) {
  return withAuth(
    async (_req, apiCtx) => {
      const siteId = await readSiteId(routeCtx);
      const items = await domainSvc.domainService.listForSite(
        { db: getDb(), logger: apiCtx.logger },
        siteId,
      );
      return ok(items, { meta: { siteId, total: items.length } });
    },
    { scopes: ['domains:read'] },
  )(req);
}

/** POST /api/v1/sites/{id}/domains — create a domain, locking the site to the path param. */
export function POST(req: NextRequest, routeCtx: RouteContext) {
  return withAuth(
    async (request, apiCtx) => {
      const siteId = await readSiteId(routeCtx);
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        throw new AppError('Invalid JSON body', { code: 'validation_failed', status: 400 });
      }
      // Ignore any siteId in the body — the URL is the source of truth.
      const merged = {
        ...(typeof body === 'object' && body ? (body as Record<string, unknown>) : {}),
        siteId,
      };
      const parsed = createDomainSchema.safeParse(merged);
      if (!parsed.success) {
        throw new AppError('Invalid request body', {
          code: 'validation_failed',
          status: 400,
          details: parsed.error.flatten(),
        });
      }
      const d = await domainSvc.domainService.create(
        { db: getDb(), logger: apiCtx.logger },
        parsed.data,
      );
      return ok(d, { status: 201 });
    },
    { scopes: ['domains:write'] },
  )(req);
}
