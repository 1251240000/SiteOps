// AdSense uses the same Google OAuth2 plumbing as Search Console — re-export
// from the shared module so callers can `import { buildAuthUrl } from
// '@siteops/integrations/adsense'` without thinking about provenance.
export {
  buildAuthUrl,
  exchangeCode,
  refreshAccessToken,
  OAuth2Error,
  type OAuth2ClientConfig,
  type OAuth2TokenResponse,
  type OAuth2StoredTokens,
} from '../search-console/oauth.js';
