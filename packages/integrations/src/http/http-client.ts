/**
 * Tiny HTTP client used by worker jobs (SEO audit, future link checker,
 * webhook notifiers). Wraps the global `fetch` so callers don't have to
 * thread `AbortController` plumbing through every job.
 *
 * Responsibilities:
 *  - Apply SSRF guard before issuing the request
 *  - Hard request timeout (default 15s) via `AbortController`
 *  - Cap response body size (default 1 MiB) so a hostile server can't
 *    OOM the worker by streaming forever
 *  - Decode body as text only; callers parse JSON / HTML themselves
 *  - Optionally follow redirects but reject if any hop fails SSRF
 *
 * NOT a streaming client. For large reports (Lighthouse JSON) the runner
 * writes directly to disk; this module is for HTML and small JSON.
 */
import { assertOutboundUrl, validateOutboundUrl } from '@siteops/shared';

export type HttpFetchOptions = {
  /** Overall timeout in ms. Default 15s. */
  timeoutMs?: number;
  /** Max body bytes to read. Default 1 MiB. */
  maxBytes?: number;
  /** User-Agent override. Defaults to `SiteOpsBot/1.0 (+https://siteops.local)`. */
  userAgent?: string;
  /** Pass-through HTTP method. Defaults to GET. */
  method?: string;
  /** Headers merged on top of defaults. */
  headers?: Record<string, string>;
  /** Body for POST/PUT. Strings only; JSON callers stringify upstream. */
  body?: string;
  /**
   * When `true` (default) we follow up to 5 redirects, validating every hop.
   * When `false` the raw 3xx response is returned and `body`/`finalUrl`
   * reflect the redirect itself.
   */
  followRedirects?: boolean;
};

export type HttpFetchResult = {
  ok: boolean;
  status: number;
  statusText: string;
  /** Final URL after redirects. */
  finalUrl: string;
  /** Lower-cased header map. */
  headers: Record<string, string>;
  /** UTF-8 decoded body (truncated to `maxBytes`). */
  body: string;
  /** True if body was cut off at `maxBytes`. */
  truncated: boolean;
  /** Total elapsed milliseconds (high-res). */
  elapsedMs: number;
};

const DEFAULT_UA = 'SiteOpsBot/1.0 (+https://siteops.local)';
const DEFAULT_TIMEOUT = 15_000;
const DEFAULT_MAX_BYTES = 1 * 1024 * 1024;
const MAX_REDIRECTS = 5;

function headersToObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

function nowMs(): number {
  return Number(process.hrtime.bigint() / 1_000_000n);
}

async function readCappedBody(
  res: Response,
  maxBytes: number,
): Promise<{ body: string; truncated: boolean }> {
  if (!res.body) return { body: '', truncated: false };
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let total = 0;
  let truncated = false;
  let out = '';
  try {
    while (total < maxBytes) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      const remaining = maxBytes - total;
      if (value.byteLength > remaining) {
        out += decoder.decode(value.subarray(0, remaining), { stream: true });
        truncated = true;
        total = maxBytes;
        break;
      }
      out += decoder.decode(value, { stream: true });
      total += value.byteLength;
    }
    out += decoder.decode();
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* lock may already be released */
    }
    // Best-effort: cancel the underlying stream so the socket can close
    // promptly. Node's undici returns void here.
    try {
      await res.body.cancel();
    } catch {
      /* ignore */
    }
  }
  return { body: out, truncated };
}

/**
 * Issue a single HTTP request (no redirect following). Internal helper used
 * by `httpFetch`; exported for callers that need fine control.
 */
async function fetchOnce(
  url: string,
  options: HttpFetchOptions,
  startedAt: number,
): Promise<HttpFetchResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const userAgent = options.userAgent ?? DEFAULT_UA;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const fetchInit: RequestInit = {
      method: options.method ?? 'GET',
      headers: {
        'user-agent': userAgent,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        ...(options.headers ?? {}),
      },
      redirect: 'manual',
      signal: controller.signal,
    };
    if (options.body !== undefined) fetchInit.body = options.body;
    const res = await fetch(url, fetchInit);
    const { body, truncated } = await readCappedBody(res, maxBytes);
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      finalUrl: url,
      headers: headersToObject(res.headers),
      body,
      truncated,
      elapsedMs: nowMs() - startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Issue an HTTP request with SSRF guard, timeout, body cap, and optional
 * redirect following (with SSRF re-validation per hop).
 */
export async function httpFetch(
  url: string,
  options: HttpFetchOptions = {},
): Promise<HttpFetchResult> {
  assertOutboundUrl(url);
  const followRedirects = options.followRedirects ?? true;
  const started = nowMs();
  let currentUrl = url;
  let lastResult: HttpFetchResult | undefined;

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    lastResult = await fetchOnce(currentUrl, options, started);
    if (!followRedirects) return lastResult;
    if (lastResult.status < 300 || lastResult.status >= 400) return lastResult;
    const loc = lastResult.headers['location'];
    if (!loc) return lastResult;
    const next = new URL(loc, currentUrl).toString();
    const guard = validateOutboundUrl(next);
    if (!guard.ok) throw new Error(`ssrf_blocked:${guard.reason}`);
    currentUrl = next;
  }
  if (!lastResult) {
    throw new Error('http_fetch_failed:no_result');
  }
  return lastResult;
}

export { DEFAULT_UA as HTTP_DEFAULT_UA };
