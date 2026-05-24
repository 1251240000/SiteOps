import { type NextRequest } from 'next/server';

import { users as userSvc } from '@siteops/services';
import {
  AppError,
  updateUserSchema,
  userIdParamSchema,
  type UserRole,
  type UserStatus,
} from '@siteops/shared';

import { getDb } from '@/lib/db';
import { ok, requirePermission, type ApiContext } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ id: string }>;
};

async function readId(ctx: RouteContext): Promise<string> {
  const { id } = await ctx.params;
  const parsed = userIdParamSchema.safeParse({ id });
  if (!parsed.success) {
    throw new AppError('Invalid user id', {
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
  perm: string,
) {
  return requirePermission(perm, async (req, apiCtx) => {
    const id = await readId(routeCtx);
    return fn(req, apiCtx, id);
  });
}

/** GET /api/v1/users/:id — fetch a single user (admin only). */
export function GET(req: NextRequest, routeCtx: RouteContext) {
  return bind(
    routeCtx,
    async (_req, apiCtx, id) => {
      const user = await userSvc.userService.getById({ db: getDb(), logger: apiCtx.logger }, id);
      return ok(user);
    },
    'users.read',
  )(req);
}

/** PATCH /api/v1/users/:id — update role or status (admin only). */
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
      const parsed = updateUserSchema.safeParse(body);
      if (!parsed.success) {
        throw new AppError('Invalid request body', {
          code: 'validation_failed',
          status: 400,
          details: parsed.error.flatten(),
        });
      }

      // Self-modification guard: prevent admin from locking themselves out.
      if (apiCtx.user && apiCtx.user.id === id) {
        if (parsed.data.role && parsed.data.role !== apiCtx.user.role) {
          throw new AppError('Cannot change your own role', {
            code: 'forbidden',
            status: 403,
          });
        }
        if (parsed.data.status === 'suspended') {
          throw new AppError('Cannot suspend yourself', {
            code: 'forbidden',
            status: 403,
          });
        }
      }

      const updateData: { role?: UserRole; status?: UserStatus } = {};
      if (parsed.data.role) updateData.role = parsed.data.role;
      if (parsed.data.status) updateData.status = parsed.data.status;
      const updated = await userSvc.userService.update(
        { db: getDb(), logger: apiCtx.logger },
        id,
        updateData,
      );
      return ok(updated);
    },
    'users.write',
  )(req);
}
