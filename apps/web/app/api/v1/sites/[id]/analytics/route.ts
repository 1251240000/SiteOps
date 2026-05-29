import { type NextRequest } from 'next/server';
import { z } from 'zod';

import { analytics as analyticsSvc } from '@siteops/services';
import { AppError, siteIdParamSchema } from '@siteops/shared';

import { getDb } from '@/lib/db';
import { ok, withAuth } from '@/lib/with-api';

import { defaultRange, isoDateRangeSchema } from '../../../metrics/_helpers';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

const querySchema = z
  .object({
    from: z.string().optional(),
    to: z.string().optional(),
  })
  .superRefine((v, ctx) => isoDateRangeSchema(v, ctx));

/** GET /api/v1/sites/{id}/analytics — self-hosted analytics overview. */
export function GET(req: NextRequest, routeCtx: RouteContext) {
  return withAuth(
    async (request) => {
      const { id } = await routeCtx.params;
      const idParse = siteIdParamSchema.safeParse({ id });
      if (!idParse.success) {
        throw new AppError('Invalid site id', {
          code: 'validation_failed',
          status: 400,
          details: idParse.error.flatten(),
        });
      }
      const url = new URL(request.url);
      const raw: Record<string, string> = {};
      for (const key of url.searchParams.keys()) raw[key] = url.searchParams.get(key) ?? '';
      const parsed = querySchema.safeParse(raw);
      if (!parsed.success) {
        throw new AppError('Invalid query parameters', {
          code: 'validation_failed',
          status: 400,
          details: parsed.error.flatten(),
        });
      }
      const range = defaultRange(parsed.data, 7);
      const overview = await analyticsSvc.analyticsAggregateService.getSiteOverview(
        getDb(),
        idParse.data.id,
        range,
      );
      return ok(overview, { meta: { from: range.from, to: range.to, siteId: idParse.data.id } });
    },
    { scopes: ['metrics:read'] },
  )(req);
}
