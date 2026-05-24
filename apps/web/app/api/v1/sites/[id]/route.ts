import { type NextRequest } from 'next/server';

import { sites as siteSvc } from '@siteops/services';
import { AppError, siteIdParamSchema, updateSiteSchema } from '@siteops/shared';

import { getDb } from '@/lib/db';
import { ok, withAuth, type ApiContext } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ id: string }>;
};

async function readId(ctx: RouteContext): Promise<string> {
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

/**
 * Bind a route-context-aware handler to `withAuth`'s `(req, ctx)` signature.
 * Next.js 15 passes dynamic params as the second argument; we close over it
 * so the `withAuth` wrapper stays generic.
 */
function bind(
  routeCtx: RouteContext,
  fn: (req: NextRequest, apiCtx: ApiContext, id: string) => Promise<Response> | Response,
  scope: string,
  permission?: string,
) {
  const opts: Parameters<typeof withAuth>[1] = { scopes: [scope] };
  if (permission) opts.permission = permission;
  return withAuth(async (req, apiCtx) => {
    const id = await readId(routeCtx);
    return fn(req, apiCtx, id);
  }, opts);
}

export function GET(req: NextRequest, routeCtx: RouteContext) {
  return bind(
    routeCtx,
    async (_req, apiCtx, id) => {
      const site = await siteSvc.siteService.getById({ db: getDb(), logger: apiCtx.logger }, id);
      return ok(site);
    },
    'sites:read',
  )(req);
}

export function PATCH(req: NextRequest, routeCtx: RouteContext) {
  return bind(
    routeCtx,
    async (request, apiCtx, id) => {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        throw new AppError('Invalid JSON body', { code: 'validation_failed', status: 400 });
      }
      const parsed = updateSiteSchema.safeParse(body);
      if (!parsed.success) {
        throw new AppError('Invalid request body', {
          code: 'validation_failed',
          status: 400,
          details: parsed.error.flatten(),
        });
      }
      const site = await siteSvc.siteService.update(
        { db: getDb(), logger: apiCtx.logger },
        id,
        parsed.data,
      );
      return ok(site);
    },
    'sites:write',
    'sites.write',
  )(req);
}

export function DELETE(req: NextRequest, routeCtx: RouteContext) {
  return bind(
    routeCtx,
    async (_req, apiCtx, id) => {
      const site = await siteSvc.siteService.archive({ db: getDb(), logger: apiCtx.logger }, id);
      return ok(site);
    },
    'sites:write',
    'sites.write',
  )(req);
}
