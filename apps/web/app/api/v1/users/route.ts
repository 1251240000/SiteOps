import { users as userSvc } from '@siteops/services';
import { AppError, listUsersQuerySchema } from '@siteops/shared';

import { getDb } from '@/lib/db';
import { ok, requirePermission } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

/** GET /api/v1/users — list users (admin only). */
export const GET = requirePermission('users.read', async (req, ctx) => {
  const url = new URL(req.url);
  const raw: Record<string, unknown> = {};
  for (const key of url.searchParams.keys()) {
    const all = url.searchParams.getAll(key);
    raw[key] = all.length > 1 ? all : all[0];
  }
  const parsed = listUsersQuerySchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError('Invalid query parameters', {
      code: 'validation_failed',
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  const page = await userSvc.userService.list(
    { db: getDb(), logger: ctx.logger },
    {
      page: parsed.data.page,
      limit: parsed.data.limit,
      status: parsed.data.status,
      role: parsed.data.role,
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
});
