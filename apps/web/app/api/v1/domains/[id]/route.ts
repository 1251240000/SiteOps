import { type NextRequest } from 'next/server';

import { domains as domainSvc } from '@siteops/services';
import { AppError, domainIdParamSchema, updateDomainSchema } from '@siteops/shared';

import { getDb } from '@/lib/db';
import { ok, withAuth, type ApiContext } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

async function readId(ctx: RouteContext): Promise<string> {
  const { id } = await ctx.params;
  const parsed = domainIdParamSchema.safeParse({ id });
  if (!parsed.success) {
    throw new AppError('Invalid domain id', {
      code: 'validation_failed',
      status: 400,
      details: parsed.error.flatten(),
    });
  }
  return parsed.data.id;
}

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
      const d = await domainSvc.domainService.getById({ db: getDb(), logger: apiCtx.logger }, id);
      return ok(d);
    },
    'domains:read',
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
      const parsed = updateDomainSchema.safeParse(body);
      if (!parsed.success) {
        throw new AppError('Invalid request body', {
          code: 'validation_failed',
          status: 400,
          details: parsed.error.flatten(),
        });
      }
      const d = await domainSvc.domainService.update(
        { db: getDb(), logger: apiCtx.logger },
        id,
        parsed.data,
      );
      return ok(d);
    },
    'domains:write',
    'domains.write',
  )(req);
}

export function DELETE(req: NextRequest, routeCtx: RouteContext) {
  return bind(
    routeCtx,
    async (_req, apiCtx, id) => {
      const d = await domainSvc.domainService.remove({ db: getDb(), logger: apiCtx.logger }, id);
      return ok(d);
    },
    'domains:write',
    'domains.write',
  )(req);
}
