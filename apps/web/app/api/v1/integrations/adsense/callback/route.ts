import { integrations as integrationsSvc } from '@siteops/services';
import { AppError } from '@siteops/shared';
import type { NextRequest } from 'next/server';

import { getAlertCipher } from '@/lib/alert-cipher';
import { getDb } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { ok, withApi } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

export const GET = withApi(async (req: NextRequest, ctx) => {
  const env = getEnv();
  if (
    !env.ADSENSE_OAUTH_CLIENT_ID ||
    !env.ADSENSE_OAUTH_CLIENT_SECRET ||
    !env.ADSENSE_OAUTH_REDIRECT_URI
  ) {
    throw new AppError('AdSense OAuth env not configured', {
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
  await integrationsSvc.adsenseService.completeOAuth(
    { db: getDb(), cipher: getAlertCipher(), logger: ctx.logger },
    {
      clientId: env.ADSENSE_OAUTH_CLIENT_ID,
      clientSecret: env.ADSENSE_OAUTH_CLIENT_SECRET,
      redirectUri: env.ADSENSE_OAUTH_REDIRECT_URI,
    },
    code,
  );
  return ok({ ok: true });
});
