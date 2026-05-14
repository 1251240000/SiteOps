/**
 * Google OAuth2 (Web Server Application) helpers shared by Search Console
 * and AdSense.
 *
 * https://developers.google.com/identity/protocols/oauth2/web-server
 *
 * MVP: the admin manually visits the auth-url page once per provider, copies
 * the `code` back into `callback`, and the refresh-token gets stored
 * (encrypted) in `integration_credentials`.
 */

const OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';

export type OAuth2Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type OAuth2ClientConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetch?: OAuth2Fetch;
  /** Override token endpoint for testing. */
  tokenUrl?: string;
};

export type OAuth2TokenResponse = {
  access_token: string;
  expires_in: number;
  scope?: string;
  token_type: 'Bearer';
  refresh_token?: string;
  id_token?: string;
};

export type OAuth2StoredTokens = {
  refreshToken: string;
  accessToken?: string;
  /** ISO timestamp when the access token expires. */
  expiresAt?: string;
  scope?: string;
};

export function buildAuthUrl(
  cfg: OAuth2ClientConfig,
  opts: { scope: string; state?: string; loginHint?: string; prompt?: string },
): string {
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: opts.prompt ?? 'consent',
    scope: opts.scope,
  });
  if (opts.state) params.set('state', opts.state);
  if (opts.loginHint) params.set('login_hint', opts.loginHint);
  return `${OAUTH_AUTH_URL}?${params.toString()}`;
}

export class OAuth2Error extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'OAuth2Error';
    this.status = status;
  }
}

async function postTokenEndpoint(
  cfg: OAuth2ClientConfig,
  body: URLSearchParams,
): Promise<OAuth2TokenResponse> {
  const fetchImpl = cfg.fetch ?? ((input, init) => fetch(input, init));
  const res = await fetchImpl(cfg.tokenUrl ?? OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    let msg = `oauth token endpoint ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string; error_description?: string };
      msg = j.error_description ?? j.error ?? msg;
    } catch {
      /* ignore */
    }
    throw new OAuth2Error(res.status, msg);
  }
  return (await res.json()) as OAuth2TokenResponse;
}

/** Exchange an authorization code for tokens. */
export async function exchangeCode(
  cfg: OAuth2ClientConfig,
  code: string,
): Promise<OAuth2TokenResponse> {
  const body = new URLSearchParams({
    code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: cfg.redirectUri,
    grant_type: 'authorization_code',
  });
  return postTokenEndpoint(cfg, body);
}

/** Refresh an access token. */
export async function refreshAccessToken(
  cfg: OAuth2ClientConfig,
  refreshToken: string,
): Promise<OAuth2TokenResponse> {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: 'refresh_token',
  });
  return postTokenEndpoint(cfg, body);
}

export { OAUTH_AUTH_URL, OAUTH_TOKEN_URL };
