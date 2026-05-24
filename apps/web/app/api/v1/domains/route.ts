import { domains as domainSvc } from '@siteops/services';
import { AppError, createDomainSchema, listDomainsQuerySchema } from '@siteops/shared';

import { getDb } from '@/lib/db';
import { ok, withAuth } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

/** GET /api/v1/domains — list with filters / sort / pagination. */
export const GET = withAuth(
  async (req, ctx) => {
    const url = new URL(req.url);
    const raw: Record<string, unknown> = {};
    for (const key of url.searchParams.keys()) {
      const all = url.searchParams.getAll(key);
      raw[key] = all.length > 1 ? all : all[0];
    }
    const parsed = listDomainsQuerySchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError('Invalid query parameters', {
        code: 'validation_failed',
        status: 400,
        details: parsed.error.flatten(),
      });
    }
    const q = parsed.data;
    const page = await domainSvc.domainService.list(
      { db: getDb(), logger: ctx.logger },
      {
        page: q.page,
        limit: q.limit,
        sort: q.sort,
        filters: {
          q: q.q,
          siteId: q.siteId,
          expiringWithinDays: q.expiringWithinDays,
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
  { scopes: ['domains:read'] },
);

/** POST /api/v1/domains — create a domain row attached to an existing site. */
export const POST = withAuth(
  async (req, ctx) => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new AppError('Invalid JSON body', { code: 'validation_failed', status: 400 });
    }
    const parsed = createDomainSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('Invalid request body', {
        code: 'validation_failed',
        status: 400,
        details: parsed.error.flatten(),
      });
    }
    const domain = await domainSvc.domainService.create(
      { db: getDb(), logger: ctx.logger },
      parsed.data,
    );
    return ok(domain, { status: 201 });
  },
  { scopes: ['domains:write'], permission: 'domains.write' },
);
