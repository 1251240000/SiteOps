import { type NextRequest } from 'next/server';

import { tasks as taskSvc } from '@siteops/services';
import { AppError, patchTaskSchema, taskIdParamSchema } from '@siteops/shared';

import { getDb } from '@/lib/db';
import { ok, withApi, withAuth } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/v1/tasks/:id — dashboard or Bearer key with `tasks:read`. */
export function GET(req: NextRequest, routeCtx: RouteContext) {
  return withAuth(
    async (_req, apiCtx) => {
      const { id } = await routeCtx.params;
      const parsed = taskIdParamSchema.safeParse({ id });
      if (!parsed.success) {
        throw new AppError('Invalid task id', {
          code: 'validation_failed',
          status: 400,
          details: parsed.error.flatten(),
        });
      }
      const task = await taskSvc.taskService.getById(
        { db: getDb(), logger: apiCtx.logger },
        parsed.data.id,
      );
      return ok(task);
    },
    { scopes: ['tasks:read'] },
  )(req);
}

/**
 * PATCH /api/v1/tasks/:id — admin-only mutations.
 *
 * Allows: cancel (`status='cancelled'`), reschedule (`availableAt`), reprioritize
 * (`priority`). Other field changes are rejected by the Zod schema. The
 * service enforces state-machine legality and surfaces `conflict` (409) when
 * the transition is illegal (e.g. cancelling a terminal row).
 */
export function PATCH(req: NextRequest, routeCtx: RouteContext) {
  return withApi(
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
      const bodyParsed = patchTaskSchema.safeParse(body);
      if (!bodyParsed.success) {
        throw new AppError('Invalid request body', {
          code: 'validation_failed',
          status: 400,
          details: bodyParsed.error.flatten(),
        });
      }
      const updated = await taskSvc.taskService.patch(
        { db: getDb(), logger: apiCtx.logger },
        idParsed.data.id,
        bodyParsed.data,
      );
      return ok(updated);
    },
    { permission: 'tasks.write' },
  )(req);
}
