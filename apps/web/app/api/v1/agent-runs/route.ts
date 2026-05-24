import { agents as agentsSvc } from '@siteops/services';
import { AppError, decodeCursor, listAgentRunsQuerySchema } from '@siteops/shared';

import { getDb } from '@/lib/db';
import { ok, withApi } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/agent-runs — admin-only audit ledger list.
 *
 * Filters: `apiKeyId`, `agentName`, `action` (`tasks.*` prefix supported),
 * `status`, `from`, `to`. Default sort is `-created_at` and `limit=50` so
 * the dashboard renders fast on the common "latest activity" view.
 *
 * Pagination (T36):
 *   - `?page=N&limit=M` — legacy offset path; `meta` carries
 *     `{ page, limit, total, totalPages }`.
 *   - `?cursor=<base64url>&limit=M` — keyset path; `page` is ignored,
 *     `meta` becomes `{ cursor: { next }, hasMore, limit }`. The cursor
 *     is opaque; clients should pass back what they got in `cursor.next`.
 *
 * Sensitive surface: only the logged-in admin session can read it. Bearer
 * keys are deliberately rejected — agents should not be able to enumerate
 * each other's actions.
 */
export const GET = withApi(async (req, ctx) => {
  const url = new URL(req.url);
  const raw: Record<string, unknown> = {};
  for (const key of url.searchParams.keys()) {
    const all = url.searchParams.getAll(key);
    raw[key] = all.length > 1 ? all : all[0];
  }
  const parsed = listAgentRunsQuerySchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError('Invalid query parameters', {
      code: 'validation_failed',
      status: 400,
      details: parsed.error.flatten(),
    });
  }
  const q = parsed.data;
  let cursor;
  if (q.cursor) {
    cursor = decodeCursor(q.cursor);
    if (!cursor) {
      throw new AppError('Invalid cursor', {
        code: 'validation_failed',
        status: 400,
        details: { cursor: 'malformed or expired' },
      });
    }
  }
  const page = await agentsSvc.agentRunService.list(
    { db: getDb(), logger: ctx.logger },
    {
      page: q.page,
      limit: q.limit,
      sort: q.sort,
      filters: {
        apiKeyId: q.apiKeyId,
        agentName: q.agentName,
        action: q.action,
        status: q.status,
        from: q.from ? new Date(q.from) : undefined,
        to: q.to ? new Date(q.to) : undefined,
      },
      ...(cursor ? { cursor } : {}),
    },
  );
  if (cursor) {
    return ok(page.items, {
      meta: {
        cursor: { next: page.nextCursor },
        hasMore: page.hasMore,
        limit: page.limit,
      },
    });
  }
  // Offset mode: include the legacy `{ page, total, totalPages }` AND a
  // forward cursor so existing UIs keep working while new clients can
  // switch to `?cursor=...` after page 1.
  return ok(page.items, {
    meta: {
      page: page.page,
      limit: page.limit,
      total: page.total,
      totalPages: Math.max(1, Math.ceil(page.total / page.limit)),
      cursor: { next: page.nextCursor },
      hasMore: page.hasMore,
    },
  });
});
