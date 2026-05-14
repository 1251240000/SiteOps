import { integrations as integrationsSvc } from '@siteops/services';
import { AppError } from '@siteops/shared';
import type { NextRequest } from 'next/server';

import { getDb } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { ok, withApi } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

export const GET = withApi(async (req: NextRequest, ctx) => {
  const token = getEnv().CF_API_TOKEN;
  if (!token) {
    throw new AppError('CF_API_TOKEN not configured', {
      code: 'validation_failed',
      status: 400,
    });
  }
  const url = new URL(req.url);
  const accountId = url.searchParams.get('accountId');
  if (!accountId) {
    throw new AppError('accountId query parameter required', {
      code: 'validation_failed',
      status: 400,
    });
  }
  const projects = await integrationsSvc.cfService.listProjects(
    { db: getDb(), logger: ctx.logger },
    token,
    accountId,
  );
  return ok(projects);
});
