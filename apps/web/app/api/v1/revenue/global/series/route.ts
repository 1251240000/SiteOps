import { z } from 'zod';

import { revenue as revenueSvc } from '@siteops/services';
import { AppError } from '@siteops/shared';

import { getDb } from '@/lib/db';
import { ok, withAuth } from '@/lib/with-api';

import { defaultRange, isoDateRangeSchema } from '../../_helpers';

export const dynamic = 'force-dynamic';

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
 * GET /api/v1/revenue/global/series
 *
 * Time-bucketed ad + affiliate revenue across every site. Affiliate
 * entries are spread evenly across their period; AdSense is row-per-day.
 */
export const GET = withAuth(
  async (req) => {
    const url = new URL(req.url);
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
    const series = await revenueSvc.revenueService.getGlobalRevenueSeries(
      { db: getDb() },
      range,
      granularity,
    );
    return ok(series, { meta: { from: range.from, to: range.to } });
  },
  { scopes: ['metrics:read'] },
);
