import { z } from 'zod';

import { roi as roiSvc } from '@siteops/services';
import { AppError } from '@siteops/shared';

import { getDb } from '@/lib/db';
import { ok, withAuth } from '@/lib/with-api';

import { defaultRange, isoDateRangeSchema } from '../_helpers';

export const dynamic = 'force-dynamic';

const SORT_KEYS = ['roi', 'revenue', 'cost', 'profit', 'rpm', 'pv'] as const;

const querySchema = z
  .object({
    from: z.string().optional(),
    to: z.string().optional(),
    sortBy: z.enum(SORT_KEYS).optional(),
  })
  .superRefine((v, ctx) => {
    isoDateRangeSchema(v, ctx);
  });

/**
 * GET /api/v1/roi/table?from&to&sortBy
 *
 * Cross-site ROI ranking with rule-based "low efficiency" flags. Default
 * sort is `roi` ascending (worst sites first); `null` ROI rows always
 * sink to the bottom regardless of sort key.
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
    const sortBy = parsed.data.sortBy ?? 'roi';
    const rows = await roiSvc.roiService.getRoiTable({ db: getDb() }, range, sortBy);
    return ok(rows, { meta: { from: range.from, to: range.to, sortBy } });
  },
  { scopes: ['metrics:read'] },
);
