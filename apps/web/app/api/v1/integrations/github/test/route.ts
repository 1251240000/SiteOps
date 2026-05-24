import { integrations as integrationsSvc } from '@siteops/services';
import { AppError } from '@siteops/shared';

import { getDb } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { ok, withApi } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

export const POST = withApi(
  async (req, ctx) => {
    let body: { token?: string } = {};
    try {
      body = (await req.json()) as { token?: string };
    } catch {
      /* empty */
    }
    const token = body.token?.trim() || getEnv().GH_TOKEN;
    if (!token) {
      throw new AppError('GH_TOKEN not configured and no token provided', {
        code: 'validation_failed',
        status: 400,
      });
    }
    const user = await integrationsSvc.ghService.verifyToken(
      { db: getDb(), logger: ctx.logger },
      token,
    );
    return ok({ ok: true, login: user.login });
  },
  { permission: 'integrations.write' },
);
