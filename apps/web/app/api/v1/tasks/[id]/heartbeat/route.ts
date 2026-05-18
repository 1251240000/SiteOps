import { type NextRequest } from 'next/server';

import { tasks as taskSvc } from '@siteops/services';
import { AppError, heartbeatTaskSchema, taskIdParamSchema } from '@siteops/shared';

import { getDb } from '@/lib/db';
import { ok, withApiKeyAudited } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/tasks/:id/heartbeat — extend the lease on a claimed task.
 *
 * Body: `{ claimToken, leaseSeconds? }`. Returns the updated task. 409
 * `claim_token_mismatch` when the token is wrong or the row is no longer
 * `claimed` (e.g. it was cancelled by the dashboard while the agent was busy).
 */
export function POST(req: NextRequest, routeCtx: RouteContext) {
  return withApiKeyAudited(
    async (rawReq, apiCtx) => {
      const { id } = await routeCtx.params;
      const idParsed = taskIdParamSchema.safeParse({ id });
      if (!idParsed.success) {
        throw new AppError('Invalid task id', {
          code: 'validation_failed',
          status: 400,
          details: idParsed.error.flatten(),
        });
      }
      let body: unknown;
      try {
        body = await rawReq.json();
      } catch {
        throw new AppError('Invalid JSON body', { code: 'validation_failed', status: 400 });
      }
      const bodyParsed = heartbeatTaskSchema.safeParse(body);
      if (!bodyParsed.success) {
        throw new AppError('Invalid request body', {
          code: 'validation_failed',
          status: 400,
          details: bodyParsed.error.flatten(),
        });
      }
      const updated = await taskSvc.taskService.heartbeat(
        { db: getDb(), logger: apiCtx.logger },
        idParsed.data.id,
        bodyParsed.data,
      );
      return ok(updated);
    },
    { action: 'tasks.heartbeat', scopes: ['tasks:claim'] },
  )(req);
}
