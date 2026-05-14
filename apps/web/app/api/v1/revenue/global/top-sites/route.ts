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
    limit: z.coerce.number().int().min(1).max(50).optional(),
  })
  .superRefine((v, ctx) => {
    isoDateRangeSchema(v, ctx);
  });

/**
 * GET /api/v1/revenue/global/top-sites?limit=10
 *
 * Top-N sites ranked by total revenue (AdSense + affiliate, spread).
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
    const limit = parsed.data.limit ?? 10;
    const rows = await revenueSvc.revenueService.getTopRevenueSites({ db: getDb() }, range, limit);
    return ok(rows, { meta: { from: range.from, to: range.to, limit } });
  },
  { scopes: ['metrics:read'] },
);
