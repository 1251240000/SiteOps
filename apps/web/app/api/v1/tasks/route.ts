import { tasks as taskSvc } from '@siteops/services';
import { AppError, createTaskSchema, listTasksQuerySchema } from '@siteops/shared';

import { getDb } from '@/lib/db';
import { ok, withAuth } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/tasks — list tasks.
 *
 * Dual-mode auth: dashboard session (admin) OR Bearer key with `tasks:read`.
 * Filters / sort / offset pagination match `listTasksQuerySchema`.
 */
export const GET = withAuth(
  async (req, ctx) => {
    const url = new URL(req.url);
    const raw: Record<string, unknown> = {};
    for (const key of url.searchParams.keys()) {
      const all = url.searchParams.getAll(key);
      raw[key] = all.length > 1 ? all : all[0];
    }
    const parsed = listTasksQuerySchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError('Invalid query parameters', {
        code: 'validation_failed',
        status: 400,
        details: parsed.error.flatten(),
      });
    }
    const q = parsed.data;
    const page = await taskSvc.taskService.list(
      { db: getDb(), logger: ctx.logger },
      {
        page: q.page,
        limit: q.limit,
        sort: q.sort,
        filters: {
          q: q.q,
          kind: q.kind,
          siteId: q.siteId,
          status: q.status,
        },
      },
    );
    return ok(page.items, {
      meta: {
        page: page.page,
        limit: page.limit,
        total: page.total,
        totalPages: Math.max(1, Math.ceil(page.total / page.limit)),
      },
    });
  },
  { scopes: ['tasks:read'] },
);

/**
 * POST /api/v1/tasks — enqueue a new task.
 *
 * Dual-mode auth: session OR Bearer key with `tasks:write`. Repeating the
 * same `dedupeKey` while a previous instance is still in-flight is
 * idempotent and surfaces `meta.idempotent=true`.
 */
export const POST = withAuth(
  async (req, ctx) => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new AppError('Invalid JSON body', { code: 'validation_failed', status: 400 });
    }
    const parsed = createTaskSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('Invalid request body', {
        code: 'validation_failed',
        status: 400,
        details: parsed.error.flatten(),
      });
    }
    const { task, created } = await taskSvc.taskService.enqueue(
      { db: getDb(), logger: ctx.logger },
      parsed.data,
    );
    return ok(task, {
      status: created ? 201 : 200,
      meta: { created, idempotent: !created },
    });
  },
  { scopes: ['tasks:write'], permission: 'tasks.write' },
);
