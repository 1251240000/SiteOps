/**
 * AdSense Management API (v2) client.
 *
 * https://developers.google.com/adsense/management/reference/rest
 *
 * MVP scope: read-only reports — earnings, PV, impressions, clicks, RPM per
 * site per day. We use the `accounts.reports.generate` endpoint with the
 * `DOMAIN_NAME` dimension so domains map back to sites in the dashboard.
 */

export type AdSenseFetch = (input: string, init?: RequestInit) => Promise<Response>;

export type AdSenseClientOptions = {
  accessToken: string;
  baseUrl?: string;
  fetch?: AdSenseFetch;
  timeoutMs?: number;
};

export type AdSenseReportCell = { value: string };
export type AdSenseReportRow = { cells: AdSenseReportCell[] };
export type AdSenseHeader = {
  name: string;
  type?: string;
  currencyCode?: string;
};

export type AdSenseReportResponse = {
  headers?: AdSenseHeader[];
  rows?: AdSenseReportRow[];
  totals?: AdSenseReportRow;
  averages?: AdSenseReportRow;
  warnings?: string[];
  endDate?: { year: number; month: number; day: number };
  startDate?: { year: number; month: number; day: number };
};

export type AdSenseReportInput = {
  startDate: { year: number; month: number; day: number };
  endDate: { year: number; month: number; day: number };
  metrics: string[];
  dimensions?: string[];
  currencyCode?: string;
  /** Page size. AdSense default is 1000. */
  pageSize?: number;
};

export class AdSenseError extends Error {
  readonly status: number;
  readonly code: 'auth_failed' | 'forbidden' | 'not_found' | 'server_error' | 'client_error';
  constructor(opts: { status: number; code: AdSenseError['code']; message: string }) {
    super(opts.message);
    this.name = 'AdSenseError';
    this.status = opts.status;
    this.code = opts.code;
  }
}

const DEFAULT_BASE = 'https://adsense.googleapis.com/v2';

function fmtDate(d: { year: number; month: number; day: number }): {
  year: string;
  month: string;
  day: string;
} {
  return {
    year: String(d.year),
    month: String(d.month),
    day: String(d.day),
  };
}

export class AdSenseClient {
  private readonly accessToken: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: AdSenseFetch;
  private readonly timeoutMs: number;

  constructor(opts: AdSenseClientOptions) {
    if (!opts.accessToken) throw new Error('AdSenseClient: accessToken required');
    this.accessToken = opts.accessToken;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/$/, '');
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  /** List the publisher's AdSense accounts. */
  async listAccounts(): Promise<
    Array<{ name: string; displayName?: string; currencyCode?: string }>
  > {
    const res = await this.request<{
      accounts?: Array<{ name: string; displayName?: string; currencyCode?: string }>;
    }>('/accounts');
    return res.accounts ?? [];
  }

  /** Generate a report. `accountName` is the full `accounts/pub-xxxx` resource. */
  async generateReport(
    accountName: string,
    input: AdSenseReportInput,
  ): Promise<AdSenseReportResponse> {
    if (!accountName) throw new Error('generateReport: accountName required');
    const start = fmtDate(input.startDate);
    const end = fmtDate(input.endDate);
    const params = new URLSearchParams();
    params.set('dateRange', 'CUSTOM');
    params.set('startDate.year', start.year);
    params.set('startDate.month', start.month);
    params.set('startDate.day', start.day);
    params.set('endDate.year', end.year);
    params.set('endDate.month', end.month);
    params.set('endDate.day', end.day);
    for (const m of input.metrics) params.append('metrics', m);
    for (const d of input.dimensions ?? []) params.append('dimensions', d);
    if (input.currencyCode) params.set('currencyCode', input.currencyCode);
    if (input.pageSize) params.set('pageSize', String(input.pageSize));
    const path = `/${accountName.replace(/^\//, '')}/reports:generate?${params.toString()}`;
    return this.request<AdSenseReportResponse>(path);
  }

  async request<T>(path: string): Promise<T> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${this.accessToken}`,
          accept: 'application/json',
        },
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      let message = `adsense ${res.status}`;
      try {
        const body = (await res.json()) as { error?: { message?: string } };
        if (body?.error?.message) message = `adsense ${res.status}: ${body.error.message}`;
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
      throw new AdSenseError({ status: res.status, code, message });
    }
    return (await res.json()) as T;
  }
}
