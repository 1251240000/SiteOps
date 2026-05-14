import { integrations as integrationsSvc } from '@siteops/services';
import { AppError } from '@siteops/shared';
import { randomBytes } from 'node:crypto';

import { getEnv } from '@/lib/env';
import { ok, withApi } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

export const GET = withApi(async () => {
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
  const state = randomBytes(16).toString('hex');
  const url = integrationsSvc.adsenseService.buildAuthUrl(
    {
      clientId: env.ADSENSE_OAUTH_CLIENT_ID,
      clientSecret: env.ADSENSE_OAUTH_CLIENT_SECRET,
      redirectUri: env.ADSENSE_OAUTH_REDIRECT_URI,
    },
    state,
  );
  return ok({ url, state });
});
