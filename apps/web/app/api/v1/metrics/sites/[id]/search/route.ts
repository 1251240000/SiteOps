import { type NextRequest } from 'next/server';
import { z } from 'zod';

import { metrics as metricsSvc } from '@siteops/services';
import { AppError, siteIdParamSchema } from '@siteops/shared';

import { getDb } from '@/lib/db';
import { ok, withAuth } from '@/lib/with-api';

import { defaultRange, isoDateRangeSchema } from '../../../_helpers';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

const querySchema = z
  .object({
    from: z.string().optional(),
    to: z.string().optional(),
    topQueries: z.coerce.number().int().min(1).max(100).optional(),
  })
  .superRefine((v, ctx) => {
    isoDateRangeSchema(v, ctx);
  });

/**
 * GET /api/v1/metrics/sites/{id}/search
 *
 * GSC summary (impressions / clicks / CTR / avg position) + Top-N queries
 * for the site. `topQueries` controls how many query rows are returned;
 * default 10, capped at 100.
 */
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
      for (const k of url.searchParams.keys()) raw[k] = url.searchParams.get(k) ?? '';
      const parsed = querySchema.safeParse(raw);
      if (!parsed.success) {
        throw new AppError('Invalid query parameters', {
          code: 'validation_failed',
          status: 400,
          details: parsed.error.flatten(),
        });
      }
      const range = defaultRange(parsed.data);
      const limit = parsed.data.topQueries ?? 10;
      const db = getDb();
      const [summary, topQueries] = await Promise.all([
        metricsSvc.trafficService.getSiteSearchSummary(db, idParse.data.id, range),
        metricsSvc.trafficService.getSiteTopQueries(db, idParse.data.id, range, limit),
      ]);
      return ok(
        { summary, topQueries },
        { meta: { from: range.from, to: range.to, siteId: idParse.data.id, limit } },
      );
    },
    { scopes: ['metrics:read'] },
  )(req);
}
