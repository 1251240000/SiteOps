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
  })
  .superRefine((v, ctx) => {
    isoDateRangeSchema(v, ctx);
  });

/**
 * GET /api/v1/metrics/global/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Returns global PV / UV / sessions totals plus same-window prior-period
 * delta. Defaults to the trailing 30 days when `from`/`to` are omitted.
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
    const summary = await metricsSvc.trafficService.getGlobalSummary(getDb(), range);
    return ok(summary, { meta: { from: range.from, to: range.to } });
  },
  { scopes: ['metrics:read'] },
);
