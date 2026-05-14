import { integrations as integrationsSvc, alerts as alertsSvc } from '@siteops/services';
import { AppError } from '@siteops/shared';
import type { NextRequest } from 'next/server';

import { getAlertCipher } from '@/lib/alert-cipher';
import { getDb } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { ok, withApi } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

export const GET = withApi(async (req: NextRequest, ctx) => {
  const env = getEnv();
  if (!env.GSC_OAUTH_CLIENT_ID || !env.GSC_OAUTH_CLIENT_SECRET || !env.GSC_OAUTH_REDIRECT_URI) {
    throw new AppError('GSC OAuth env not configured', {
      code: 'validation_failed',
      status: 400,
    });
  }
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  if (!code) {
    throw new AppError('code query parameter required', {
      code: 'validation_failed',
      status: 400,
    });
  }
  // Surface the cipher singleton (alertsSvc.AlertCipher is the same class).
  void alertsSvc;
  await integrationsSvc.gscService.completeOAuth(
    { db: getDb(), cipher: getAlertCipher(), logger: ctx.logger },
    {
      clientId: env.GSC_OAUTH_CLIENT_ID,
      clientSecret: env.GSC_OAUTH_CLIENT_SECRET,
      redirectUri: env.GSC_OAUTH_REDIRECT_URI,
    },
    code,
  );
  return ok({ ok: true });
});
