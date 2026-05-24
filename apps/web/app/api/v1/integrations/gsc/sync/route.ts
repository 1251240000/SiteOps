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
    if (!env.GSC_OAUTH_CLIENT_ID || !env.GSC_OAUTH_CLIENT_SECRET || !env.GSC_OAUTH_REDIRECT_URI) {
      throw new AppError('GSC OAuth env not configured', {
        code: 'validation_failed',
        status: 400,
      });
    }
    const summaries = await integrationsSvc.gscService.syncAll(
      { db: getDb(), cipher: getAlertCipher(), logger: ctx.logger },
      {
        clientId: env.GSC_OAUTH_CLIENT_ID,
        clientSecret: env.GSC_OAUTH_CLIENT_SECRET,
        redirectUri: env.GSC_OAUTH_REDIRECT_URI,
      },
    );
    return ok({ summaries });
  },
  { permission: 'integrations.write' },
);
