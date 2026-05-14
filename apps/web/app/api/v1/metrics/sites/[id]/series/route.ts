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
    granularity: z.enum(['day', 'week']).optional(),
  })
  .superRefine((v, ctx) => {
    isoDateRangeSchema(v, ctx);
  });

/**
 * GET /api/v1/metrics/sites/{id}/series
 *
 * Per-site time-bucketed PV / UV / sessions. Bundles `summary` so the
 * per-site dashboard can render KPIs and chart from a single payload.
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
      const granularity = parsed.data.granularity ?? 'day';
      const db = getDb();
      const [summary, series] = await Promise.all([
        metricsSvc.trafficService.getSiteSummary(db, idParse.data.id, range),
        metricsSvc.trafficService.getSiteSeries(db, idParse.data.id, range, granularity),
      ]);
      return ok(
        { summary, series },
        { meta: { from: range.from, to: range.to, siteId: idParse.data.id, granularity } },
      );
    },
    { scopes: ['metrics:read'] },
  )(req);
}
