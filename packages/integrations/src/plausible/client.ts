/**
 * Plausible Analytics v1 API client.
 *
 * https://plausible.io/docs/stats-api
 *
 * MVP scope: fetch daily PV/UV/bounce-rate via `/api/v1/stats/timeseries`.
 */

export type PlausibleFetch = (input: string, init?: RequestInit) => Promise<Response>;

export type PlausibleClientOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: PlausibleFetch;
  timeoutMs?: number;
};

export type PlausibleDayPoint = {
  date: string; // YYYY-MM-DD
  pageviews: number;
  visitors: number;
  visits: number;
  bounce_rate: number;
  visit_duration: number;
};

export class PlausibleError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'PlausibleError';
    this.status = status;
  }
}

const DEFAULT_BASE = 'https://plausible.io';

export class PlausibleClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: PlausibleFetch;
  private readonly timeoutMs: number;

  constructor(opts: PlausibleClientOptions) {
    if (!opts.apiKey) throw new Error('PlausibleClient: apiKey is required');
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/$/, '');
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  /** Return one row per day between start..end inclusive for `siteId`. */
  async timeseries(
    siteId: string,
    period: { start: string; end: string },
  ): Promise<PlausibleDayPoint[]> {
    if (!siteId) throw new Error('timeseries: siteId required');
    const params = new URLSearchParams({
      site_id: siteId,
      period: 'custom',
      date: `${period.start},${period.end}`,
      metrics: 'visitors,pageviews,visits,bounce_rate,visit_duration',
    });
    const url = `${this.baseUrl}/api/v1/stats/timeseries?${params.toString()}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          accept: 'application/json',
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      let message = `plausible ${res.status}`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body?.error) message = `plausible ${res.status}: ${body.error}`;
      } catch {
        /* ignore */
      }
      throw new PlausibleError(res.status, message);
    }
    const body = (await res.json()) as { results?: PlausibleDayPoint[] };
    return body.results ?? [];
  }

  async verifyAccess(siteId: string): Promise<boolean> {
    const today = new Date().toISOString().slice(0, 10);
    await this.timeseries(siteId, { start: today, end: today });
    return true;
  }
}
