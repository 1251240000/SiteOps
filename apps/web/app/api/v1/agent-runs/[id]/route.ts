import { type NextRequest } from 'next/server';

import { agents as agentsSvc } from '@siteops/services';
import { AppError, agentRunIdParamSchema } from '@siteops/shared';

import { getDb } from '@/lib/db';
import { ok, withApi } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/agent-runs/:id — single-row admin view with full `input` /
 * `output` JSON for debugging. Admin session required.
 */
export function GET(req: NextRequest, routeCtx: RouteContext) {
  return withApi(async (_req, apiCtx) => {
    const { id } = await routeCtx.params;
    const parsed = agentRunIdParamSchema.safeParse({ id });
    if (!parsed.success) {
      throw new AppError('Invalid agent run id', {
        code: 'validation_failed',
        status: 400,
        details: parsed.error.flatten(),
      });
    }
    const run = await agentsSvc.agentRunService.getById(
      { db: getDb(), logger: apiCtx.logger },
      parsed.data.id,
    );
    return ok(run);
  })(req);
}
