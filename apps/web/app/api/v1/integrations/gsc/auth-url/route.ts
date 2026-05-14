import { integrations as integrationsSvc } from '@siteops/services';
import { AppError } from '@siteops/shared';

import { getEnv } from '@/lib/env';
import { ok, withApi } from '@/lib/with-api';
import { getDb } from '@/lib/db';
import { randomBytes } from 'node:crypto';

export const dynamic = 'force-dynamic';

export const GET = withApi(async () => {
  const env = getEnv();
  if (!env.GSC_OAUTH_CLIENT_ID || !env.GSC_OAUTH_CLIENT_SECRET || !env.GSC_OAUTH_REDIRECT_URI) {
    throw new AppError('GSC OAuth env not configured', {
      code: 'validation_failed',
      status: 400,
    });
  }
  // Silence unused getDb import — we only need env-based state for now.
  void getDb;
  const state = randomBytes(16).toString('hex');
  const url = integrationsSvc.gscService.buildAuthUrl(
    {
      clientId: env.GSC_OAUTH_CLIENT_ID,
      clientSecret: env.GSC_OAUTH_CLIENT_SECRET,
      redirectUri: env.GSC_OAUTH_REDIRECT_URI,
    },
    state,
  );
  return ok({ url, state });
});
