/**
 * Google Search Console API client.
 *
 * https://developers.google.com/webmaster-tools/v1/searchanalytics/query
 */

export type GscFetch = (input: string, init?: RequestInit) => Promise<Response>;

export type GscClientOptions = {
  accessToken: string;
  fetch?: GscFetch;
  baseUrl?: string;
  timeoutMs?: number;
};

export type GscDimension = 'date' | 'query' | 'country' | 'device' | 'page' | 'searchAppearance';

export type GscQueryRequest = {
  startDate: string;
  endDate: string;
  dimensions?: GscDimension[];
  rowLimit?: number;
  startRow?: number;
  type?: 'web' | 'image' | 'video' | 'news' | 'discover' | 'googleNews';
};

export type GscQueryRow = {
  keys?: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type GscQueryResponse = {
  rows?: GscQueryRow[];
  responseAggregationType?: string;
};

export class GscError extends Error {
  readonly status: number;
  readonly code: 'auth_failed' | 'forbidden' | 'not_found' | 'server_error' | 'client_error';
  constructor(opts: { status: number; code: GscError['code']; message: string }) {
    super(opts.message);
    this.name = 'GscError';
    this.status = opts.status;
    this.code = opts.code;
  }
}

const DEFAULT_BASE = 'https://searchconsole.googleapis.com/webmasters/v3';

export class SearchConsoleClient {
  private readonly accessToken: string;
  private readonly fetchImpl: GscFetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(opts: GscClientOptions) {
    if (!opts.accessToken) throw new Error('SearchConsoleClient: accessToken required');
    this.accessToken = opts.accessToken;
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/$/, '');
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  async searchAnalyticsQuery(siteUrl: string, request: GscQueryRequest): Promise<GscQueryResponse> {
    if (!siteUrl) throw new Error('searchAnalyticsQuery: siteUrl required');
    const url = `${this.baseUrl}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${this.accessToken}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(request),
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      let message = `gsc ${res.status}`;
      try {
        const body = (await res.json()) as { error?: { message?: string } };
        if (body?.error?.message) message = `gsc ${res.status}: ${body.error.message}`;
      } catch {
        /* ignore */
      }
      const code =
        res.status === 401
          ? 'auth_failed'
          : res.status === 403
            ? 'forbidden'
            : res.status === 404
              ? 'not_found'
              : res.status >= 500
                ? 'server_error'
                : 'client_error';
      throw new GscError({ status: res.status, code, message });
    }
    return (await res.json()) as GscQueryResponse;
  }

  /** List all Search Console properties the access token has access to. */
  async listSites(): Promise<Array<{ siteUrl: string; permissionLevel: string }>> {
    const url = `${this.baseUrl}/sites`;
    const res = await this.fetchImpl(url, {
      headers: {
        authorization: `Bearer ${this.accessToken}`,
        accept: 'application/json',
      },
    });
    if (!res.ok) {
      let message = `gsc ${res.status}`;
      try {
        const body = (await res.json()) as { error?: { message?: string } };
        if (body?.error?.message) message = `gsc ${res.status}: ${body.error.message}`;
      } catch {
        /* ignore */
      }
      throw new GscError({
        status: res.status,
        code: res.status === 401 ? 'auth_failed' : 'client_error',
        message,
      });
    }
    const body = (await res.json()) as {
      siteEntry?: Array<{ siteUrl: string; permissionLevel: string }>;
    };
    return body.siteEntry ?? [];
  }
}
