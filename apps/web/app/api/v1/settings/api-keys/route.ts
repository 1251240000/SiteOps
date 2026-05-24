import { type NextRequest } from 'next/server';

import { auth as authSvc } from '@siteops/services';
import { AppError, createApiKeySchema } from '@siteops/shared';

import { getDb } from '@/lib/db';
import { ok, withApi } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

/** GET /api/v1/settings/api-keys — admin list (safe view, no key_hash). */
export const GET = withApi(
  async (req, ctx) => {
    const url = new URL(req.url);
    const stateRaw = url.searchParams.get('state');
    const state =
      stateRaw === 'active' || stateRaw === 'revoked' || stateRaw === 'expired'
        ? stateRaw
        : undefined;
    const page = Number(url.searchParams.get('page') ?? '1');
    const limit = Number(url.searchParams.get('limit') ?? '50');

    const out = await authSvc.apiKeyService.list(
      { db: getDb(), logger: ctx.logger },
      { filters: state ? { state } : {}, page, limit, sort: '-created_at' },
    );
    return ok(out.items, {
      meta: {
        page: out.page,
        limit: out.limit,
        total: out.total,
        totalPages: Math.max(1, Math.ceil(out.total / out.limit)),
      },
    });
  },
  { permission: 'api_keys.read' },
);

/**
 * POST /api/v1/settings/api-keys — issue a new key. Plaintext is returned
 * once in `data.plaintext`; the dashboard must display it to the admin and
 * forget it. Subsequent reads of the row never expose it again.
 */
export function POST(req: NextRequest) {
  return withApi(
    async (rawReq, ctx) => {
      let body: unknown;
      try {
        body = await rawReq.json();
      } catch {
        throw new AppError('Invalid JSON body', { code: 'validation_failed', status: 400 });
      }
      const parsed = createApiKeySchema.safeParse(body);
      if (!parsed.success) {
        throw new AppError('Invalid request body', {
          code: 'validation_failed',
          status: 400,
          details: parsed.error.flatten(),
        });
      }
      const result = await authSvc.apiKeyService.create(
        { db: getDb(), logger: ctx.logger },
        {
          name: parsed.data.name,
          scopes: parsed.data.scopes,
          ...(parsed.data.expiresAt ? { expiresAt: parsed.data.expiresAt } : {}),
          ...(parsed.data.rateLimitPerMin !== undefined
            ? { rateLimitPerMin: parsed.data.rateLimitPerMin }
            : {}),
        },
      );
      return ok({ apiKey: result.apiKey, plaintext: result.plaintext }, { status: 201 });
    },
    { permission: 'api_keys.write' },
  )(req);
}
