import { errorTracking as errSvc } from '@siteops/services';
import { AppError, listErrorsQuerySchema, reportErrorBodySchema } from '@siteops/shared';

import { getDb } from '@/lib/db';
import { ok, withAuth, withApiKey } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

/** GET /api/v1/errors — dashboard list. */
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
    const page = await errSvc.errorTrackingService.list(
      { db: getDb(), logger: ctx.logger },
      { page: parsed.data.page, limit: parsed.data.limit, filters },
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
  { scopes: ['errors:read'] },
);

/** POST /api/v1/errors — receive error reports (API key, `errors:write`). */
export const POST = withApiKey(
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
  { scopes: ['errors:write'] },
);
