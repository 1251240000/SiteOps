import { integrations as integrationsSvc } from '@siteops/services';
import { AppError } from '@siteops/shared';

import { getDb } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { ok, withApi } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

export const POST = withApi(async (req, ctx) => {
  let body: { apiToken?: string } = {};
  try {
    body = (await req.json()) as { apiToken?: string };
  } catch {
    /* empty body is fine — fall back to env. */
  }
  const token = body.apiToken?.trim() || getEnv().CF_API_TOKEN;
  if (!token) {
    throw new AppError('CF_API_TOKEN not configured and no token provided', {
      code: 'validation_failed',
      status: 400,
    });
  }
  const tokenInfo = await integrationsSvc.cfService.verifyToken(
    { db: getDb(), logger: ctx.logger },
    token,
  );
  return ok({ ok: true, id: tokenInfo.id, status: tokenInfo.status });
});
