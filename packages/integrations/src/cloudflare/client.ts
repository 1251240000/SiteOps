/**
 * Cloudflare API client.
 *
 * Responsibilities:
 *   - Authenticate with a long-lived API token (Bearer)
 *   - Wrap the canonical envelope so callers receive plain TypeScript values
 *   - Retry transient (429 + 5xx) failures with bounded exponential backoff
 *   - Honour the platform's `Retry-After` header when present
 *
 * The client takes an injectable `fetch` implementation so tests can stub
 * network calls without resorting to global monkey-patching. The default is
 * the global `fetch` provided by Node 18+.
 */

import type {
  CfApiEnvelope,
  CfPagesDeployment,
  CfPagesProject,
  CfTokenVerification,
} from './types.js';

const CF_API_BASE = 'https://api.cloudflare.com/client/v4';

export type CfFetch = (input: string, init?: RequestInit) => Promise<Response>;
export type {
  CfApiEnvelope,
  CfPagesProject,
  CfPagesDeployment,
  CfTokenVerification,
} from './types.js';

export type CloudflareClientOptions = {
  apiToken: string;
  baseUrl?: string;
  /** Override `fetch` for tests / proxying. */
  fetch?: CfFetch;
  /** Hard cap on retries. Default 3. */
  maxRetries?: number;
  /** Initial backoff (ms). Default 500. */
  retryBaseMs?: number;
  /** Per-request timeout (ms). Default 15000. */
  timeoutMs?: number;
};

export type CfRequestError = {
  status: number;
  code: 'auth_failed' | 'rate_limited' | 'server_error' | 'client_error' | 'network';
  message: string;
  retryAfterMs?: number;
};

export class CloudflareError extends Error {
  readonly status: number;
  readonly code: CfRequestError['code'];
  readonly retryAfterMs: number | undefined;
  constructor(info: CfRequestError) {
    super(info.message);
    this.name = 'CloudflareError';
    this.status = info.status;
    this.code = info.code;
    this.retryAfterMs = info.retryAfterMs;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classify(status: number): CfRequestError['code'] {
  if (status === 401 || status === 403) return 'auth_failed';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server_error';
  return 'client_error';
}

export class CloudflareClient {
  private readonly apiToken: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: CfFetch;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  private readonly timeoutMs: number;

  constructor(options: CloudflareClientOptions) {
    if (!options.apiToken) {
      throw new Error('CloudflareClient: apiToken is required');
    }
    this.apiToken = options.apiToken;
    this.baseUrl = (options.baseUrl ?? CF_API_BASE).replace(/\/$/, '');
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.maxRetries = options.maxRetries ?? 3;
    this.retryBaseMs = options.retryBaseMs ?? 500;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  /** Issue a single request and unwrap the CF envelope. Retries on 5xx/429. */
  async request<T>(path: string, init: RequestInit = {}): Promise<CfApiEnvelope<T>> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    let attempt = 0;
    while (true) {
      attempt += 1;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          ...init,
          signal: controller.signal,
          headers: {
            authorization: `Bearer ${this.apiToken}`,
            'content-type': 'application/json',
            accept: 'application/json',
            ...(init.headers ?? {}),
          },
        });
      } catch (err) {
        clearTimeout(timeout);
        if (attempt > this.maxRetries) {
          throw new CloudflareError({
            status: 0,
            code: 'network',
            message: err instanceof Error ? err.message : String(err),
          });
        }
        await sleep(this.retryBaseMs * 2 ** (attempt - 1));
        continue;
      }
      clearTimeout(timeout);

      // Drain JSON regardless of status so we can read the error envelope.
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        body = null;
      }

      if (res.ok && body && typeof body === 'object' && (body as CfApiEnvelope<T>).success) {
        return body as CfApiEnvelope<T>;
      }

      const code = classify(res.status);
      const envelope = body as CfApiEnvelope<unknown> | null;
      const firstErr = envelope?.errors?.[0];
      const message = firstErr
        ? `cf ${res.status}: ${firstErr.message} (code ${firstErr.code})`
        : `cf ${res.status}: ${res.statusText || 'request failed'}`;

      const transient = code === 'rate_limited' || code === 'server_error';
      if (transient && attempt <= this.maxRetries) {
        const retryHeader = Number(res.headers.get('retry-after') ?? '0');
        const wait =
          Number.isFinite(retryHeader) && retryHeader > 0
            ? retryHeader * 1000
            : this.retryBaseMs * 2 ** (attempt - 1);
        await sleep(wait);
        continue;
      }

      throw new CloudflareError({
        status: res.status,
        code,
        message,
        ...(res.headers.get('retry-after')
          ? { retryAfterMs: Number(res.headers.get('retry-after')) * 1000 }
          : {}),
      });
    }
  }

  // ---------- Higher-level convenience methods ----------

  /** Probe the token. Throws `CloudflareError` on failure. */
  async verifyToken(): Promise<CfTokenVerification> {
    const env = await this.request<CfTokenVerification>('/user/tokens/verify');
    return env.result;
  }

  /** List all Pages projects for the account, paginated server-side. */
  async listPagesProjects(accountId: string): Promise<CfPagesProject[]> {
    if (!accountId) throw new Error('listPagesProjects: accountId required');
    const all: CfPagesProject[] = [];
    let page = 1;
    while (true) {
      const env = await this.request<CfPagesProject[]>(
        `/accounts/${encodeURIComponent(accountId)}/pages/projects?page=${page}&per_page=50`,
      );
      const batch = env.result ?? [];
      all.push(...batch);
      const totalPages = env.result_info?.total_pages ?? 1;
      if (batch.length === 0 || page >= totalPages) break;
      page += 1;
      if (page > 50) break; // sanity cap
    }
    return all;
  }

  /** List deployments for a Pages project. Filters client-side by `since`. */
  async listDeployments(
    accountId: string,
    projectName: string,
    options: { since?: Date; maxPages?: number } = {},
  ): Promise<CfPagesDeployment[]> {
    if (!accountId || !projectName) {
      throw new Error('listDeployments: accountId + projectName required');
    }
    const maxPages = options.maxPages ?? 5;
    const out: CfPagesDeployment[] = [];
    for (let page = 1; page <= maxPages; page += 1) {
      const env = await this.request<CfPagesDeployment[]>(
        `/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(
          projectName,
        )}/deployments?page=${page}&per_page=25`,
      );
      const batch = env.result ?? [];
      if (batch.length === 0) break;
      out.push(...batch);
      const oldest = batch[batch.length - 1];
      if (options.since && oldest && new Date(oldest.created_on) < options.since) break;
      const totalPages = env.result_info?.total_pages ?? 1;
      if (page >= totalPages) break;
    }
    if (options.since) {
      const since = options.since.getTime();
      return out.filter((d) => new Date(d.created_on).getTime() >= since);
    }
    return out;
  }

  async getDeployment(
    accountId: string,
    projectName: string,
    deploymentId: string,
  ): Promise<CfPagesDeployment> {
    const env = await this.request<CfPagesDeployment>(
      `/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(
        projectName,
      )}/deployments/${encodeURIComponent(deploymentId)}`,
    );
    return env.result;
  }
}

export { CF_API_BASE };
