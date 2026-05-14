import { z } from 'zod';

import { metrics as metricsSvc } from '@siteops/services';
import { AppError } from '@siteops/shared';

import { getDb } from '@/lib/db';
import { ok, withAuth } from '@/lib/with-api';

import { defaultRange, isoDateRangeSchema } from '../../_helpers';

export const dynamic = 'force-dynamic';

const querySchema = z
  .object({
    from: z.string().optional(),
    to: z.string().optional(),
    metric: z.enum(['pv', 'uv', 'sessions']).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  })
  .superRefine((v, ctx) => {
    isoDateRangeSchema(v, ctx);
  });

/**
 * GET /api/v1/metrics/global/top-sites
 *
 * Sites ordered by `metric` (default `pv`). Used by the global Top-N table.
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
    const metric = parsed.data.metric ?? 'pv';
    const limit = parsed.data.limit ?? 10;
    const rows = await metricsSvc.trafficService.getTopSites(getDb(), range, metric, limit);
    return ok(rows, { meta: { from: range.from, to: range.to, metric, limit } });
  },
  { scopes: ['metrics:read'] },
);
