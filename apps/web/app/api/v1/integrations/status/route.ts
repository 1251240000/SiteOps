import { ok, withApi } from '@/lib/with-api';
import { getEnv } from '@/lib/env';
import { readIntegrationStatus } from '../_helpers';

export const dynamic = 'force-dynamic';

export const GET = withApi(async () => {
  const env = getEnv();
  const [cf, gh, ga4, plausible, gsc, adsense] = await Promise.all([
    readIntegrationStatus('cloudflare'),
    readIntegrationStatus('github'),
    readIntegrationStatus('ga4'),
    readIntegrationStatus('plausible'),
    readIntegrationStatus('gsc'),
    readIntegrationStatus('adsense'),
  ]);
  return ok({
    cloudflare: { ...cf, hasToken: Boolean(env.CF_API_TOKEN) },
    github: { ...gh, hasToken: Boolean(env.GH_TOKEN) },
    ga4: { ...ga4, hasToken: Boolean(env.GA4_SERVICE_ACCOUNT_JSON) },
    plausible: { ...plausible, hasToken: Boolean(env.PLAUSIBLE_API_KEY) },
    gsc: {
      ...gsc,
      hasOAuthClient: Boolean(env.GSC_OAUTH_CLIENT_ID && env.GSC_OAUTH_CLIENT_SECRET),
    },
    adsense: {
      ...adsense,
      hasOAuthClient: Boolean(env.ADSENSE_OAUTH_CLIENT_ID && env.ADSENSE_OAUTH_CLIENT_SECRET),
      hasAccountName: Boolean(env.ADSENSE_ACCOUNT_NAME),
    },
  });
});
