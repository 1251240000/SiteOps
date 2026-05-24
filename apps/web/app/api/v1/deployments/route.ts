import { deployments as deploySvc } from '@siteops/services';
import { AppError, createDeploymentSchema, listDeploymentsQuerySchema } from '@siteops/shared';

import { getDb } from '@/lib/db';
import { ok, withAuth } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

/** GET /api/v1/deployments — list with filters / sort / pagination. */
export const GET = withAuth(
  async (req, ctx) => {
    const url = new URL(req.url);
    const raw: Record<string, unknown> = {};
    for (const key of url.searchParams.keys()) {
      const all = url.searchParams.getAll(key);
      raw[key] = all.length > 1 ? all : all[0];
    }
    const parsed = listDeploymentsQuerySchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError('Invalid query parameters', {
        code: 'validation_failed',
        status: 400,
        details: parsed.error.flatten(),
      });
    }
    const q = parsed.data;
    const page = await deploySvc.deploymentService.list(
      { db: getDb(), logger: ctx.logger },
      {
        page: q.page,
        limit: q.limit,
        sort: q.sort,
        filters: {
          q: q.q,
          siteId: q.siteId,
          status: q.status,
          provider: q.provider,
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
  { scopes: ['deployments:read'] },
);

/**
 * POST /api/v1/deployments — record (or merge) a deployment event.
 *
 * The dashboard form and external Agents both hit this endpoint. Idempotency
 * key is `(provider, providerDeploymentId)`; re-POSTing the same event will
 * walk the state machine instead of inserting a duplicate row.
 */
export const POST = withAuth(
  async (req, ctx) => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new AppError('Invalid JSON body', { code: 'validation_failed', status: 400 });
    }
    const parsed = createDeploymentSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('Invalid request body', {
        code: 'validation_failed',
        status: 400,
        details: parsed.error.flatten(),
      });
    }
    const { deployment, created } = await deploySvc.deploymentService.create(
      { db: getDb(), logger: ctx.logger },
      parsed.data,
    );
    return ok(deployment, {
      status: created ? 201 : 200,
      meta: { created, idempotent: !created },
    });
  },
  { scopes: ['deployments:write'], permission: 'deployments.write' },
);
