import { type NextRequest } from 'next/server';

import { deployments as deploySvc } from '@siteops/services';
import { AppError, siteIdParamSchema } from '@siteops/shared';

import { getDb } from '@/lib/db';
import { ok, withAuth } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/v1/sites/{id}/deployments — convenience for the site timeline. */
export function GET(req: NextRequest, routeCtx: RouteContext) {
  return withAuth(
    async (request, apiCtx) => {
      const { id } = await routeCtx.params;
      const parsed = siteIdParamSchema.safeParse({ id });
      if (!parsed.success) {
        throw new AppError('Invalid site id', {
          code: 'validation_failed',
          status: 400,
          details: parsed.error.flatten(),
        });
      }
      const url = new URL(request.url);
      const limit = Math.min(
        200,
        Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? '50', 10) || 50),
      );
      const items = await deploySvc.deploymentService.listForSite(
        { db: getDb(), logger: apiCtx.logger },
        parsed.data.id,
        { limit },
      );
      return ok(items, { meta: { siteId: parsed.data.id, total: items.length } });
    },
    { scopes: ['deployments:read'] },
  )(req);
}
