import { type NextRequest } from 'next/server';

import { deployments as deploySvc } from '@siteops/services';
import { AppError, deploymentIdParamSchema } from '@siteops/shared';

import { getDb } from '@/lib/db';
import { ok, withAuth } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export function GET(req: NextRequest, routeCtx: RouteContext) {
  return withAuth(
    async (_req, apiCtx) => {
      const { id } = await routeCtx.params;
      const parsed = deploymentIdParamSchema.safeParse({ id });
      if (!parsed.success) {
        throw new AppError('Invalid deployment id', {
          code: 'validation_failed',
          status: 400,
          details: parsed.error.flatten(),
        });
      }
      const d = await deploySvc.deploymentService.getById(
        { db: getDb(), logger: apiCtx.logger },
        parsed.data.id,
      );
      return ok(d);
    },
    { scopes: ['deployments:read'] },
  )(req);
}
