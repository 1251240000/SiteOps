import { tasks as taskSvc } from '@siteops/services';
import { AppError, claimTaskSchema } from '@siteops/shared';

import { getDb } from '@/lib/db';
import { ok, withApiKeyAudited } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/tasks/claim — agent pull endpoint.
 *
 * Returns either:
 *   `{ data: <task>, meta: { idle: false } }` (200) when a row was claimed, or
 *   `{ data: null,   meta: { idle: true  } }` (200) when the queue is empty.
 *
 * The caller (Bearer key, scope `tasks:claim`) must save `data.claimToken`
 * and present it back on heartbeat / complete / fail.
 */
export const POST = withApiKeyAudited(
  async (req, ctx) => {
    let body: unknown = {};
    try {
      const text = await req.text();
      if (text.length > 0) body = JSON.parse(text);
    } catch {
      throw new AppError('Invalid JSON body', { code: 'validation_failed', status: 400 });
    }
    const parsed = claimTaskSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('Invalid request body', {
        code: 'validation_failed',
        status: 400,
        details: parsed.error.flatten(),
      });
    }
    const result = await taskSvc.taskService.claimNext(
      { db: getDb(), logger: ctx.logger },
      parsed.data,
      ctx.apiKey?.id ?? null,
    );
    if (result.idle) {
      return ok(null, { meta: { idle: true } });
    }
    return ok(result.task, { meta: { idle: false } });
  },
  { action: 'tasks.claim', scopes: ['tasks:claim'] },
);
