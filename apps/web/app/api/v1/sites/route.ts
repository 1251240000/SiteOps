import { sites as siteSvc } from '@siteops/services';
import { AppError, createSiteSchema, listSitesQuerySchema } from '@siteops/shared';

import { getDb } from '@/lib/db';
import { ok, withAuth } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/sites — list with filters / sort / offset pagination.
 *
 * Accepts either a session cookie (dashboard) or a Bearer API key with the
 * `sites:read` scope (external Agent).
 */
export const GET = withAuth(
  async (req, ctx) => {
    const url = new URL(req.url);
    const raw: Record<string, unknown> = {};
    for (const key of url.searchParams.keys()) {
      const all = url.searchParams.getAll(key);
      raw[key] = all.length > 1 ? all : all[0];
    }
    const parsed = listSitesQuerySchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError('Invalid query parameters', {
        code: 'validation_failed',
        status: 400,
        details: parsed.error.flatten(),
      });
    }

    const q = parsed.data;
    const page = await siteSvc.siteService.list(
      { db: getDb(), logger: ctx.logger },
      {
        page: q.page,
        limit: q.limit,
        sort: q.sort,
        filters: {
          q: q.q,
          siteType: q.siteType,
          status: q.status,
          country: q.country,
          tag: q.tag,
          includeArchived: q.archived,
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
  { scopes: ['sites:read'] },
);

/** POST /api/v1/sites — create a new site (admin / `sites:write`). */
export const POST = withAuth(
  async (req, ctx) => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new AppError('Invalid JSON body', { code: 'validation_failed', status: 400 });
    }
    const parsed = createSiteSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('Invalid request body', {
        code: 'validation_failed',
        status: 400,
        details: parsed.error.flatten(),
      });
    }
    const site = await siteSvc.siteService.create({ db: getDb(), logger: ctx.logger }, parsed.data);
    return ok(site, { status: 201 });
  },
  { scopes: ['sites:write'] },
);
