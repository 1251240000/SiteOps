/**
 * GitHub REST API client.
 *
 * Notes:
 *   - Uses Bearer auth with PAT or fine-grained token (same wire format).
 *   - Respects `x-ratelimit-remaining`/`x-ratelimit-reset` — when remaining
 *     hits 0 the client refuses to issue further calls until the reset epoch.
 *   - Retries on 5xx + 429 with exponential backoff; surfaces a typed error
 *     for 401/403/404 so callers can short-circuit.
 */

import type {
  GhCommitEnvelope,
  GhRateLimit,
  GhWorkflowRun,
  GhWorkflowRunListEnvelope,
} from './types.js';

const GH_API_BASE = 'https://api.github.com';
const DEFAULT_UA = 'siteops-integrations/1.0';

export type GhFetch = (input: string, init?: RequestInit) => Promise<Response>;

export type GitHubClientOptions = {
  token: string;
  baseUrl?: string;
  fetch?: GhFetch;
  maxRetries?: number;
  retryBaseMs?: number;
  timeoutMs?: number;
  userAgent?: string;
};

export class GitHubError extends Error {
  readonly status: number;
  readonly code:
    | 'auth_failed'
    | 'forbidden'
    | 'not_found'
    | 'rate_limited'
    | 'server_error'
    | 'network';
  constructor(opts: { status: number; code: GitHubError['code']; message: string }) {
    super(opts.message);
    this.name = 'GitHubError';
    this.status = opts.status;
    this.code = opts.code;
  }
}

function classify(status: number): GitHubError['code'] {
  if (status === 401) return 'auth_failed';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server_error';
  return 'forbidden';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class GitHubClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: GhFetch;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  private readonly timeoutMs: number;
  private readonly userAgent: string;
  private rateLimit: GhRateLimit | null = null;

  constructor(options: GitHubClientOptions) {
    if (!options.token) throw new Error('GitHubClient: token is required');
    this.token = options.token;
    this.baseUrl = (options.baseUrl ?? GH_API_BASE).replace(/\/$/, '');
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.maxRetries = options.maxRetries ?? 3;
    this.retryBaseMs = options.retryBaseMs ?? 500;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.userAgent = options.userAgent ?? DEFAULT_UA;
  }

  getRateLimit(): GhRateLimit | null {
    return this.rateLimit;
  }

  private capture(res: Response): void {
    const limit = Number(res.headers.get('x-ratelimit-limit') ?? '0');
    const remaining = Number(res.headers.get('x-ratelimit-remaining') ?? '0');
    const reset = Number(res.headers.get('x-ratelimit-reset') ?? '0');
    if (Number.isFinite(limit) && Number.isFinite(remaining) && Number.isFinite(reset)) {
      this.rateLimit = { limit, remaining, reset };
    }
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    // If we know we're rate-limited, sleep until reset (capped).
    if (this.rateLimit && this.rateLimit.remaining <= 0) {
      const now = Math.floor(Date.now() / 1000);
      const wait = Math.max(0, this.rateLimit.reset - now);
      if (wait > 0 && wait < 60) await sleep(wait * 1000);
    }

    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    let attempt = 0;
    while (true) {
      attempt += 1;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          ...init,
          signal: controller.signal,
          headers: {
            authorization: `Bearer ${this.token}`,
            accept: 'application/vnd.github+json',
            'x-github-api-version': '2022-11-28',
            'user-agent': this.userAgent,
            ...(init.headers ?? {}),
          },
        });
      } catch (err) {
        clearTimeout(timer);
        if (attempt > this.maxRetries) {
          throw new GitHubError({
            status: 0,
            code: 'network',
            message: err instanceof Error ? err.message : String(err),
          });
        }
        await sleep(this.retryBaseMs * 2 ** (attempt - 1));
        continue;
      }
      clearTimeout(timer);
      this.capture(res);

      if (res.ok) {
        if (res.status === 204) return undefined as unknown as T;
        try {
          return (await res.json()) as T;
        } catch {
          return undefined as unknown as T;
        }
      }

      const code = classify(res.status);
      const transient = code === 'rate_limited' || code === 'server_error';
      let message = `gh ${res.status}: ${res.statusText || 'request failed'}`;
      try {
        const body = (await res.json()) as { message?: string };
        if (body?.message) message = `gh ${res.status}: ${body.message}`;
      } catch {
        /* ignore */
      }

      if (transient && attempt <= this.maxRetries) {
        const retryAfter = Number(res.headers.get('retry-after') ?? '0');
        const wait =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : this.retryBaseMs * 2 ** (attempt - 1);
        await sleep(wait);
        continue;
      }
      throw new GitHubError({ status: res.status, code, message });
    }
  }

  // ---------------- Convenience methods ----------------

  /** Probe the token by fetching `/user`. */
  async verifyToken(): Promise<{ login: string; id: number }> {
    return this.request<{ login: string; id: number }>('/user');
  }

  async listWorkflowRuns(
    owner: string,
    repo: string,
    options: { since?: Date; perPage?: number; maxPages?: number } = {},
  ): Promise<GhWorkflowRun[]> {
    const perPage = Math.min(100, Math.max(1, options.perPage ?? 30));
    const maxPages = options.maxPages ?? 3;
    const out: GhWorkflowRun[] = [];
    const sinceMs = options.since?.getTime();
    let page = 1;
    while (page <= maxPages) {
      const env = await this.request<GhWorkflowRunListEnvelope>(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs?per_page=${perPage}&page=${page}`,
      );
      const runs = env.workflow_runs ?? [];
      if (runs.length === 0) break;
      out.push(...runs);
      // Early-stop when oldest run on the page is older than `since`.
      const oldest = runs[runs.length - 1];
      if (sinceMs !== undefined && oldest) {
        if (new Date(oldest.created_at).getTime() < sinceMs) break;
      }
      if (runs.length < perPage) break;
      page += 1;
    }
    if (sinceMs !== undefined) {
      return out.filter((r) => new Date(r.created_at).getTime() >= sinceMs);
    }
    return out;
  }

  async getCommit(owner: string, repo: string, sha: string): Promise<GhCommitEnvelope> {
    return this.request<GhCommitEnvelope>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(sha)}`,
    );
  }
}

export { GH_API_BASE };
export type {
  GhRateLimit,
  GhWorkflowRun,
  GhWorkflowRunListEnvelope,
  GhCommitEnvelope,
} from './types.js';
