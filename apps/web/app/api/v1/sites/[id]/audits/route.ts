import { type NextRequest } from 'next/server';
import { z } from 'zod';

import { audits as auditsSvc, sites as siteSvc } from '@siteops/services';
import { AppError, siteIdParamSchema } from '@siteops/shared';

import { getDb } from '@/lib/db';
import { getProducerQueue } from '@/lib/queues';
import { ok, withAuth } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

const triggerSchema = z.object({
  type: z.enum(['seo', 'lighthouse']).default('seo'),
  /** Run inline (default) or enqueue. */
  async: z.boolean().default(false),
});

/** GET /api/v1/sites/{id}/audits — list runs for one site. */
export function GET(req: NextRequest, routeCtx: RouteContext) {
  return withAuth(
    async (request, apiCtx) => {
      const { id } = await routeCtx.params;
      const parsed = siteIdParamSchema.safeParse({ id });
      if (!parsed.success) {
        throw new AppError('Invalid site id', {
          code: 'validation_failed',
          status: 400,
          details: parsed.error.flatten(),
        });
      }
      const url = new URL(request.url);
      const page = Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
      const limit = Math.min(
        100,
        Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? '20', 10) || 20),
      );
      const runs = await auditsSvc.auditService.listRuns(
        { db: getDb(), logger: apiCtx.logger },
        { filters: { siteId: parsed.data.id }, page, limit },
      );
      return ok(runs.items, {
        meta: {
          page: runs.page,
          limit: runs.limit,
          total: runs.total,
          totalPages: Math.max(1, Math.ceil(runs.total / runs.limit)),
        },
      });
    },
    { scopes: ['audits:read'] },
  )(req);
}

/** POST /api/v1/sites/{id}/audits — trigger a new audit run. */
export function POST(req: NextRequest, routeCtx: RouteContext) {
  return withAuth(
    async (request, apiCtx) => {
      const { id } = await routeCtx.params;
      const parsed = siteIdParamSchema.safeParse({ id });
      if (!parsed.success) {
        throw new AppError('Invalid site id', {
          code: 'validation_failed',
          status: 400,
          details: parsed.error.flatten(),
        });
      }
      let body: unknown = {};
      try {
        body = await request.json();
      } catch {
        body = {};
      }
      const p = triggerSchema.safeParse(body);
      if (!p.success) {
        throw new AppError('Invalid request body', {
          code: 'validation_failed',
          status: 400,
          details: p.error.flatten(),
        });
      }
      const deps = { db: getDb(), logger: apiCtx.logger };
      if (p.data.async) {
        const queue = getProducerQueue(p.data.type === 'seo' ? 'seo-audit' : 'lighthouse-run');
        const job = await queue.add(
          p.data.type === 'seo' ? 'audit' : 'run',
          { siteId: parsed.data.id },
          { jobId: `${p.data.type}-manual:${parsed.data.id}:${Date.now()}` },
        );
        return ok({ enqueued: true, jobId: job.id }, { status: 202 });
      }
      if (p.data.type === 'seo') {
        const site = await siteSvc.siteService.getById(deps, parsed.data.id);
        const result = await auditsSvc.auditService.runSeoAudit(deps, {
          siteId: site.id,
          siteUrl: site.primaryUrl,
        });
        return ok(
          { run: result.run, summary: result.summary, findings: result.findings.length },
          { status: 201 },
        );
      }
      // Lighthouse (T14) — inline path also lives in the service but is
      // expected to be enqueued in practice (chromium takes time).
      throw new AppError('Inline lighthouse runs are not supported yet — pass `async: true`.', {
        code: 'not_implemented',
        status: 400,
      });
    },
    { scopes: ['audits:write'], permission: 'sites.write' },
  )(req);
}
