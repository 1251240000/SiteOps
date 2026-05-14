import { integrations as integrationsSvc } from '@siteops/services';
import { AppError } from '@siteops/shared';

import { getDb } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { ok, withApi } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

export const POST = withApi(async (_req, ctx) => {
  const token = getEnv().GH_TOKEN;
  if (!token) {
    throw new AppError('GH_TOKEN not configured', { code: 'validation_failed', status: 400 });
  }
  const summaries = await integrationsSvc.ghService.syncAll(
    { db: getDb(), logger: ctx.logger },
    token,
  );
  return ok({
    sites: summaries.length,
    inserted: summaries.reduce((a, s) => a + s.inserted, 0),
    updated: summaries.reduce((a, s) => a + s.updated, 0),
    summaries,
  });
});
