import { errorTracking as errSvc } from '@siteops/services';
import {
  AppError,
  decodeCursor,
  listErrorsQuerySchema,
  reportErrorBodySchema,
} from '@siteops/shared';

import { getDb } from '@/lib/db';
import { ok, withApiKeyAudited, withAuth } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/errors — dashboard list.
 *
 * Pagination (T36):
 *   - `?page=N&limit=M` — legacy offset path.
 *   - `?cursor=<base64url>&limit=M` — keyset path; meta becomes
 *     `{ cursor: { next }, hasMore, limit }`. `last_seen_at DESC` is the
 *     stable sort, so resolving an error mid-walk may shift its position
 *     on subsequent pages — that's expected, and the cursor still
 *     guarantees forward progress.
 */
export const GET = withAuth(
  async (req, ctx) => {
    const url = new URL(req.url);
    const raw: Record<string, string> = {};
    for (const key of url.searchParams.keys()) {
      raw[key] = url.searchParams.get(key) ?? '';
    }
    const parsed = listErrorsQuerySchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError('Invalid query parameters', {
        code: 'validation_failed',
        status: 400,
        details: parsed.error.flatten(),
      });
    }
    const filters = {
      ...(parsed.data.siteId ? { siteId: parsed.data.siteId } : {}),
      ...(parsed.data.level ? { level: parsed.data.level } : {}),
      ...(parsed.data.q ? { q: parsed.data.q } : {}),
      resolved: parsed.data.resolved ?? false,
    } as const;
    let cursor;
    if (parsed.data.cursor) {
      cursor = decodeCursor(parsed.data.cursor);
      if (!cursor) {
        throw new AppError('Invalid cursor', {
          code: 'validation_failed',
          status: 400,
          details: { cursor: 'malformed or expired' },
        });
      }
    }
    const page = await errSvc.errorTrackingService.list(
      { db: getDb(), logger: ctx.logger },
      {
        page: parsed.data.page,
        limit: parsed.data.limit,
        filters,
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
    // Offset mode also exposes a forward cursor so callers can switch
    // to keyset mode after page 1 without an awkward bootstrap.
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
  },
  { scopes: ['errors:read'] },
);

/**
 * POST /api/v1/errors — receive error reports (API key, `errors:write`).
 *
 * Audited via `withApiKeyAudited` — every call lands a row on `agent_runs`
 * with `action='errors.report'`. Behavior is otherwise unchanged from the
 * pre-T26 `withApiKey` version (same 201 envelope, same error mapping).
 */
export const POST = withApiKeyAudited(
  async (req, ctx) => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new AppError('Invalid JSON body', { code: 'validation_failed', status: 400 });
    }
    const parsed = reportErrorBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('Invalid request body', {
        code: 'validation_failed',
        status: 400,
        details: parsed.error.flatten(),
      });
    }
    const batch = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
    const deps = { db: getDb(), logger: ctx.logger };
    const results = [] as Array<{ id: string; created: boolean; count: number }>;
    for (const item of batch) {
      const { row, created } = await errSvc.errorTrackingService.report(deps, item);
      results.push({ id: row.id, created, count: row.count });
    }
    return ok(results, { status: 201, meta: { received: results.length } });
  },
  { action: 'errors.report', scopes: ['errors:write'] },
);
