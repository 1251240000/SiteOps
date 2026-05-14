import { type NextRequest } from 'next/server';
import { z } from 'zod';

import { uptime as uptimeSvc } from '@siteops/services';
import { AppError, siteIdParamSchema } from '@siteops/shared';

import { getDb } from '@/lib/db';
import { ok, withAuth } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

const querySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  /** Default window: last 24h. */
  windowHours: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .optional(),
  granularity: z.enum(['5m', '1h', '1d']).optional(),
  limitFailures: z.coerce.number().int().min(1).max(100).optional(),
});

/**
 * GET /api/v1/sites/{id}/uptime — summary + series + recent failures.
 *
 * Default window is the last 24 hours at 5-minute granularity; pass
 * `?windowHours=168&granularity=1h` for the 7-day view.
 */
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
      const raw: Record<string, string> = {};
      for (const key of url.searchParams.keys()) {
        raw[key] = url.searchParams.get(key) ?? '';
      }
      const q = querySchema.safeParse(raw);
      if (!q.success) {
        throw new AppError('Invalid query parameters', {
          code: 'validation_failed',
          status: 400,
          details: q.error.flatten(),
        });
      }

      const to = q.data.to ? new Date(q.data.to) : new Date();
      const from = q.data.from
        ? new Date(q.data.from)
        : new Date(to.getTime() - (q.data.windowHours ?? 24) * 60 * 60 * 1000);
      const granularity =
        q.data.granularity ??
        (to.getTime() - from.getTime() > 7 * 24 * 60 * 60 * 1000 ? '1d' : '5m');
      const deps = { db: getDb(), logger: apiCtx.logger };

      const [summary, series, recentFailures] = await Promise.all([
        uptimeSvc.uptimeService.summary(deps, parsed.data.id, to.getTime() - from.getTime()),
        uptimeSvc.uptimeService.series(deps, parsed.data.id, from, to, granularity),
        uptimeSvc.uptimeService.recentFailures(deps, parsed.data.id, q.data.limitFailures ?? 10),
      ]);

      return ok({
        summary,
        series,
        recentFailures,
        from: from.toISOString(),
        to: to.toISOString(),
        granularity,
      });
    },
    { scopes: ['uptime:read'] },
  )(req);
}
