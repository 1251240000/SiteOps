import { integrations as integrationsSvc } from '@siteops/services';
import { ga4 } from '@siteops/integrations';
import { AppError } from '@siteops/shared';

import { getDb } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { ok, withApi } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

export const POST = withApi(
  async (_req, ctx) => {
    const env = getEnv();
    const inputs: Parameters<typeof integrationsSvc.analyticsService.syncAll>[1] = {};
    if (env.GA4_SERVICE_ACCOUNT_JSON) {
      inputs.ga4ServiceAccount = ga4.parseServiceAccountEnv(env.GA4_SERVICE_ACCOUNT_JSON);
    }
    if (env.PLAUSIBLE_API_KEY) inputs.plausibleApiKey = env.PLAUSIBLE_API_KEY;
    if (!inputs.ga4ServiceAccount && !inputs.plausibleApiKey) {
      throw new AppError('No analytics provider configured', {
        code: 'validation_failed',
        status: 400,
      });
    }
    const summaries = await integrationsSvc.analyticsService.syncAll(
      { db: getDb(), logger: ctx.logger },
      inputs,
    );
    return ok({ summaries });
  },
  { permission: 'integrations.write' },
);
