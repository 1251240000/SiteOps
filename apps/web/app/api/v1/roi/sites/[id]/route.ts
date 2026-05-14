import { type NextRequest } from 'next/server';
import { z } from 'zod';

import { roi as roiSvc } from '@siteops/services';
import { AppError, siteIdParamSchema } from '@siteops/shared';

import { getDb } from '@/lib/db';
import { ok, withAuth } from '@/lib/with-api';

import { defaultRange, isoDateRangeSchema } from '../../_helpers';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

const querySchema = z
  .object({
    from: z.string().optional(),
    to: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    isoDateRangeSchema(v, ctx);
  });

/**
 * GET /api/v1/roi/sites/{id}
 *
 * Per-site ROI detail: KPI row, breakdown, and a per-day series of
 * `revenue` vs `cost` vs `profit`.
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
      const detail = await roiSvc.roiService.getSiteRoi({ db: getDb() }, idParse.data.id, range);
      return ok(detail, { meta: { from: range.from, to: range.to } });
    },
    { scopes: ['metrics:read'] },
  )(req);
}
