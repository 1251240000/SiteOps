import { ga4 } from '@siteops/integrations';
import { AppError } from '@siteops/shared';

import { getEnv } from '@/lib/env';
import { ok, withApi } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

export const POST = withApi(async (req) => {
  let body: { propertyId?: string } = {};
  try {
    body = (await req.json()) as { propertyId?: string };
  } catch {
    /* empty body is fine */
  }
  const env = getEnv();
  if (!env.GA4_SERVICE_ACCOUNT_JSON) {
    throw new AppError('GA4_SERVICE_ACCOUNT_JSON not configured', {
      code: 'validation_failed',
      status: 400,
    });
  }
  if (!body.propertyId) {
    throw new AppError('propertyId required', { code: 'validation_failed', status: 400 });
  }
  const sa = ga4.parseServiceAccountEnv(env.GA4_SERVICE_ACCOUNT_JSON);
  const client = new ga4.Ga4Client({ serviceAccount: sa });
  await client.verifyAccess(body.propertyId);
  return ok({ ok: true });
});
