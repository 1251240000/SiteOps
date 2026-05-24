import { integrations as integrationsSvc } from '@siteops/services';
import { AppError } from '@siteops/shared';

import { getAlertCipher } from '@/lib/alert-cipher';
import { getDb } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { ok, withApi } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

export const POST = withApi(
  async (_req, ctx) => {
    const env = getEnv();
    if (
      !env.ADSENSE_OAUTH_CLIENT_ID ||
      !env.ADSENSE_OAUTH_CLIENT_SECRET ||
      !env.ADSENSE_OAUTH_REDIRECT_URI ||
      !env.ADSENSE_ACCOUNT_NAME
    ) {
      throw new AppError('AdSense env not configured', {
        code: 'validation_failed',
        status: 400,
      });
    }
    const summary = await integrationsSvc.adsenseService.syncDaily(
      { db: getDb(), cipher: getAlertCipher(), logger: ctx.logger },
      {
        clientId: env.ADSENSE_OAUTH_CLIENT_ID,
        clientSecret: env.ADSENSE_OAUTH_CLIENT_SECRET,
        redirectUri: env.ADSENSE_OAUTH_REDIRECT_URI,
      },
      env.ADSENSE_ACCOUNT_NAME,
    );
    return ok(summary);
  },
  { permission: 'integrations.write' },
);
