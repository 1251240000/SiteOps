/**
 * GA4 Data API client (REST).
 *
 * Authenticates with a Google service-account key using the JWT bearer flow
 * (https://developers.google.com/identity/protocols/oauth2/service-account).
 * We avoid the official `googleapis` Node SDK because it pulls in ~30 MB of
 * transitive deps; the JWT exchange is ~80 lines of crypto + fetch.
 *
 * Public surface:
 *   - `runReport(propertyId, opts)` — wraps `properties.runReport`
 *   - `verifyAccess(propertyId)`    — issues a 1-day report and checks 2xx
 */

import { createSign } from 'node:crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GA_API_BASE = 'https://analyticsdata.googleapis.com/v1beta';
const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

export type GoogleServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

export type Ga4Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type Ga4ClientOptions = {
  serviceAccount: GoogleServiceAccount;
  fetch?: Ga4Fetch;
  /** Override the wall clock; used by tests. */
  now?: () => number;
  timeoutMs?: number;
};

export type Ga4DateRange = { startDate: string; endDate: string };

export type Ga4ReportRow = {
  dimensionValues: { value: string }[];
  metricValues: { value: string }[];
};

export type Ga4Report = {
  rows?: Ga4ReportRow[];
  rowCount?: number;
  dimensionHeaders?: { name: string }[];
  metricHeaders?: { name: string; type?: string }[];
};

export type Ga4RunReportInput = {
  dateRanges: Ga4DateRange[];
  metrics: { name: string }[];
  dimensions?: { name: string }[];
  limit?: number;
};

export class Ga4Error extends Error {
  readonly status: number;
  readonly code:
    | 'auth_failed'
    | 'forbidden'
    | 'not_found'
    | 'server_error'
    | 'client_error'
    | 'network';
  constructor(opts: { status: number; code: Ga4Error['code']; message: string }) {
    super(opts.message);
    this.name = 'Ga4Error';
    this.status = opts.status;
    this.code = opts.code;
  }
}

function base64url(buf: Buffer | string): string {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/** Build and sign a Google service-account JWT. */
export function signServiceAccountJwt(
  sa: GoogleServiceAccount,
  opts: { scope?: string; now?: number },
): string {
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: sa.client_email,
    scope: opts.scope ?? SCOPE,
    aud: sa.token_uri ?? TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const segments = [base64url(JSON.stringify(header)), base64url(JSON.stringify(payload))];
  const data = segments.join('.');
  const signer = createSign('RSA-SHA256');
  signer.update(data);
  const signature = signer.sign(sa.private_key);
  return `${data}.${base64url(signature)}`;
}

/** Parse a service account JSON blob (or its base64 form). */
export function parseServiceAccountEnv(raw: string): GoogleServiceAccount {
  if (!raw) throw new Error('parseServiceAccountEnv: empty input');
  let text = raw.trim();
  if (!text.startsWith('{')) {
    try {
      text = Buffer.from(text, 'base64').toString('utf8');
    } catch {
      throw new Error('parseServiceAccountEnv: not valid JSON or base64');
    }
  }
  const obj = JSON.parse(text) as GoogleServiceAccount;
  if (!obj.client_email || !obj.private_key) {
    throw new Error('parseServiceAccountEnv: missing client_email or private_key');
  }
  return obj;
}

export class Ga4Client {
  private readonly sa: GoogleServiceAccount;
  private readonly fetchImpl: Ga4Fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private accessToken: { token: string; expiresAt: number } | null = null;

  constructor(options: Ga4ClientOptions) {
    this.sa = options.serviceAccount;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.now = options.now ?? (() => Date.now());
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  /** Exchange the service-account JWT for an OAuth2 access token. */
  async getAccessToken(): Promise<string> {
    const cushion = 60_000;
    if (this.accessToken && this.accessToken.expiresAt - cushion > this.now()) {
      return this.accessToken.token;
    }
    const jwt = signServiceAccountJwt(this.sa, { now: this.now() });
    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }).toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(this.sa.token_uri ?? TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      throw new Ga4Error({
        status: 0,
        code: 'network',
        message: err instanceof Error ? err.message : String(err),
      });
    }
    clearTimeout(timer);
    if (!res.ok) {
      let message = `token exchange failed (${res.status})`;
      try {
        const body2 = (await res.json()) as { error_description?: string; error?: string };
        message = body2?.error_description ?? body2?.error ?? message;
      } catch {
        /* ignore */
      }
      throw new Ga4Error({
        status: res.status,
        code: res.status === 401 || res.status === 403 ? 'auth_failed' : 'client_error',
        message,
      });
    }
    const data = (await res.json()) as { access_token: string; expires_in: number };
    this.accessToken = {
      token: data.access_token,
      expiresAt: this.now() + data.expires_in * 1000,
    };
    return data.access_token;
  }

  /** `properties.runReport`. */
  async runReport(propertyId: string, input: Ga4RunReportInput): Promise<Ga4Report> {
    if (!propertyId) throw new Error('runReport: propertyId required');
    const id = propertyId.startsWith('properties/') ? propertyId : `properties/${propertyId}`;
    const token = await this.getAccessToken();
    const body = JSON.stringify(input);
    const url = `${GA_API_BASE}/${id}:runReport`;
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body,
    });
    if (!res.ok) {
      let message = `ga4 ${res.status}`;
      try {
        const errBody = (await res.json()) as { error?: { message?: string } };
        if (errBody?.error?.message) message = errBody.error.message;
      } catch {
        /* ignore */
      }
      const code =
        res.status === 401 || res.status === 403
          ? 'auth_failed'
          : res.status === 404
            ? 'not_found'
            : res.status >= 500
              ? 'server_error'
              : 'client_error';
      throw new Ga4Error({ status: res.status, code, message });
    }
    return (await res.json()) as Ga4Report;
  }

  /** Probe access by running a 1-day, single-metric report. */
  async verifyAccess(propertyId: string): Promise<boolean> {
    const today = new Date().toISOString().slice(0, 10);
    await this.runReport(propertyId, {
      dateRanges: [{ startDate: today, endDate: today }],
      metrics: [{ name: 'sessions' }],
    });
    return true;
  }
}

export { GA_API_BASE, TOKEN_URL };
