import { type NextRequest } from 'next/server';

import { auth as authSvc } from '@siteops/services';
import { AppError, apiKeyIdParamSchema, updateApiKeySchema } from '@siteops/shared';

import { getDb } from '@/lib/db';
import { ok, withApi } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/** DELETE /api/v1/settings/api-keys/:id — revoke (idempotent). */
export function DELETE(req: NextRequest, routeCtx: RouteContext) {
  return withApi(
    async (_req, apiCtx) => {
      const { id } = await routeCtx.params;
      const parsed = apiKeyIdParamSchema.safeParse({ id });
      if (!parsed.success) {
        throw new AppError('Invalid api key id', {
          code: 'validation_failed',
          status: 400,
          details: parsed.error.flatten(),
        });
      }
      const row = await authSvc.apiKeyService.revoke(
        { db: getDb(), logger: apiCtx.logger },
        parsed.data.id,
      );
      return ok(row);
    },
    { permission: 'api_keys.write' },
  )(req);
}

/**
 * PATCH /api/v1/settings/api-keys/:id — update mutable fields on an active
 * key. Currently the only mutable field is `rateLimitPerMin` (T38).
 *
 * `rateLimitPerMin: null` clears the override (key falls back to env).
 * Omitting the field is rejected by `updateApiKeySchema` (must update at
 * least one column).
 */
export function PATCH(req: NextRequest, routeCtx: RouteContext) {
  return withApi(
    async (rawReq, apiCtx) => {
      const { id } = await routeCtx.params;
      const idParsed = apiKeyIdParamSchema.safeParse({ id });
      if (!idParsed.success) {
        throw new AppError('Invalid api key id', {
          code: 'validation_failed',
          status: 400,
          details: idParsed.error.flatten(),
        });
      }
      let body: unknown;
      try {
        body = await rawReq.json();
      } catch {
        throw new AppError('Invalid JSON body', { code: 'validation_failed', status: 400 });
      }
      const bodyParsed = updateApiKeySchema.safeParse(body);
      if (!bodyParsed.success) {
        throw new AppError('Invalid request body', {
          code: 'validation_failed',
          status: 400,
          details: bodyParsed.error.flatten(),
        });
      }

      // Only one mutable field today; route to its dedicated service method.
      if (bodyParsed.data.rateLimitPerMin !== undefined) {
        const row = await authSvc.apiKeyService.updateRateLimit(
          { db: getDb(), logger: apiCtx.logger },
          idParsed.data.id,
          bodyParsed.data.rateLimitPerMin,
        );
        return ok(row);
      }

      // Defensive: schema's `.refine` already rejects empty bodies.
      throw new AppError('No mutable fields supplied', {
        code: 'validation_failed',
        status: 400,
      });
    },
    { permission: 'api_keys.write' },
  )(req);
}
