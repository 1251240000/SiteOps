import { type NextRequest } from 'next/server';

import { auth as authSvc } from '@siteops/services';
import { AppError, apiKeyIdParamSchema } from '@siteops/shared';

import { getDb } from '@/lib/db';
import { ok, withApi } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/** DELETE /api/v1/settings/api-keys/:id — revoke (idempotent). */
export function DELETE(req: NextRequest, routeCtx: RouteContext) {
  return withApi(async (_req, apiCtx) => {
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
  })(req);
}
