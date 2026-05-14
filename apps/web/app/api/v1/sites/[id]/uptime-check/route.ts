import { type NextRequest } from 'next/server';

import { uptime as uptimeSvc } from '@siteops/services';
import { AppError, siteIdParamSchema } from '@siteops/shared';

import { getDb } from '@/lib/db';
import { getProducerQueue } from '@/lib/queues';
import { ok, withAuth } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/sites/{id}/uptime-check — manually trigger a probe.
 *
 * Default mode runs the check **inline** (so the dashboard "Check now"
 * button gets a fresh result without round-tripping through Redis). Pass
 * `?async=1` to enqueue a BullMQ job instead — useful when the user just
 * wants a batched re-check across many sites.
 */
export function POST(req: NextRequest, routeCtx: RouteContext) {
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
      const asAsync = url.searchParams.get('async') === '1';
      const deps = { db: getDb(), logger: apiCtx.logger };

      if (asAsync) {
        try {
          const queue = getProducerQueue('uptime-check');
          const job = await queue.add(
            'check-manual',
            { siteId: parsed.data.id },
            { jobId: `uptime-manual:${parsed.data.id}:${Date.now()}` },
          );
          return ok({ enqueued: true, jobId: job.id }, { status: 202 });
        } catch (err) {
          apiCtx.logger.warn(
            { err: { message: err instanceof Error ? err.message : String(err) } },
            'failed to enqueue manual uptime check; falling back to inline',
          );
        }
      }

      const result = await uptimeSvc.uptimeService.checkAndRecord(deps, parsed.data.id);
      return ok(
        {
          check: result.check,
          consecutiveFailures: result.consecutiveFailures,
          newHealthScore: result.newHealthScore,
        },
        { status: 201 },
      );
    },
    { scopes: ['uptime:write'] },
  )(req);
}
