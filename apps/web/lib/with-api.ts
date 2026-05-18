/**
 * Unified API route wrappers.
 *
 * `withApi` — session-required (browser / dashboard endpoints).
 * `withApiKey` — bearer-token required (external Agents).
 *
 * Both wrappers:
 *   - mint a `requestId`, expose it via `x-request-id` and `error.requestId`
 *   - attach a pino child logger bound to method + path + requestId
 *   - translate `AppError` (and anything else) into the canonical JSON
 *     error shape defined in `docs/04-api-spec.md`.
 */
import { type NextRequest, NextResponse } from 'next/server';

import { agents as agentsSvc, auth as authService } from '@siteops/services';
import { AppError, isAppError } from '@siteops/shared';

import { auth } from './auth';
import { getDb } from './db';
import { getLogger, type Logger } from './logger';
import { checkApiKeyRateLimit, type ApiKeyRateLimitResult } from './rate-limit';
import { getOrCreateRequestId } from './request-id';

export type AuthedUser = {
  id: string;
  email: string;
  name: string | null;
};

export type AuthedApiKey = {
  id: string;
  name: string;
  scopes: string[];
};

export type ApiContext = {
  requestId: string;
  logger: Logger;
  user?: AuthedUser;
  apiKey?: AuthedApiKey;
};

export type ApiHandler = (
  req: NextRequest,
  ctx: ApiContext,
) => Promise<Response | NextResponse> | Response | NextResponse;

export type WithApiKeyOptions = {
  /** Scopes the caller must hold (all of them). `*` on the key grants all. */
  scopes?: readonly string[];
};

/** Build the canonical error JSON body per docs/04-api-spec.md. */
function errorBody(
  code: string,
  message: string,
  requestId: string,
  details?: unknown,
): Record<string, unknown> {
  const error: Record<string, unknown> = { code, message, requestId };
  if (details !== undefined) error['details'] = details;
  return { error };
}

function jsonError(
  status: number,
  code: string,
  message: string,
  requestId: string,
  details?: unknown,
): NextResponse {
  const res = NextResponse.json(errorBody(code, message, requestId, details), {
    status,
  });
  res.headers.set('x-request-id', requestId);
  return res;
}

function stampRequestId(res: Response | NextResponse, requestId: string): void {
  if (!res.headers.has('x-request-id')) res.headers.set('x-request-id', requestId);
}

/** Decorate any response with `X-RateLimit-*` for clients that watch them. */
function stampRateLimitHeaders(res: Response | NextResponse, rl: ApiKeyRateLimitResult): void {
  res.headers.set('x-ratelimit-limit', String(rl.limit));
  res.headers.set('x-ratelimit-remaining', String(Math.max(0, rl.limit - rl.count)));
  res.headers.set('x-ratelimit-reset', String(rl.retryAfterSec));
}

/**
 * Enforce per-key sliding window. Returns the 429 response when over budget,
 * or the `ApiKeyRateLimitResult` for the caller to attach as headers.
 */
async function enforceApiKeyRateLimit(
  apiKeyId: string,
  requestId: string,
  log: Logger,
): Promise<{ rl: ApiKeyRateLimitResult; denied?: NextResponse }> {
  const rl = await checkApiKeyRateLimit(apiKeyId);
  if (!rl.allowed) {
    log.warn({ apiKeyId, count: rl.count, limit: rl.limit }, 'api key rate limit exceeded');
    const res = jsonError(
      429,
      'rate_limited',
      `Rate limit exceeded (${rl.limit}/min). Retry after ${rl.retryAfterSec}s.`,
      requestId,
      { retryAfterSec: rl.retryAfterSec },
    );
    res.headers.set('retry-after', String(rl.retryAfterSec));
    stampRateLimitHeaders(res, rl);
    return { rl, denied: res };
  }
  return { rl };
}

function handleError(err: unknown, requestId: string, log: Logger): NextResponse {
  if (isAppError(err)) {
    log.warn({ err: { message: err.message, code: err.code } }, 'request error (AppError)');
    return jsonError(err.status, err.code, err.message, requestId, err.details);
  }
  const message = err instanceof Error ? err.message : String(err);
  log.error({ err: { message } }, 'unhandled error');
  return jsonError(500, 'internal_error', 'Internal server error', requestId);
}

function bindLogger(req: NextRequest, requestId: string): Logger {
  let pathname = '';
  try {
    pathname = new URL(req.url).pathname;
  } catch {
    pathname = '';
  }
  return getLogger().child({ requestId, method: req.method, path: pathname });
}

/** Require a logged-in admin session. */
export function withApi(handler: ApiHandler) {
  return async (req: NextRequest): Promise<Response> => {
    const requestId = getOrCreateRequestId(req.headers);
    const log = bindLogger(req, requestId);
    try {
      const session = await auth();
      const sUser = session?.user;
      if (!sUser?.id) {
        return jsonError(401, 'unauthorized', 'Authentication required', requestId);
      }
      const ctx: ApiContext = {
        requestId,
        logger: log,
        user: {
          id: sUser.id,
          email: sUser.email ?? '',
          name: sUser.name ?? null,
        },
      };
      const res = await handler(req, ctx);
      stampRequestId(res, requestId);
      return res;
    } catch (err) {
      return handleError(err, requestId, log);
    }
  };
}

/** Require a valid `Authorization: Bearer <api-key>` header. */
export function withApiKey(handler: ApiHandler, options: WithApiKeyOptions = {}) {
  return async (req: NextRequest): Promise<Response> => {
    const requestId = getOrCreateRequestId(req.headers);
    const log = bindLogger(req, requestId);
    try {
      const header = req.headers.get('authorization') ?? '';
      const match = /^Bearer\s+(.+)$/i.exec(header);
      if (!match) {
        return jsonError(401, 'unauthorized', 'API key required', requestId);
      }
      const plaintext = match[1]?.trim();
      if (!plaintext) {
        return jsonError(401, 'unauthorized', 'API key required', requestId);
      }

      const key = await authService.verifyApiKey(getDb(), plaintext);
      if (!key) {
        log.info({ ip: req.headers.get('x-forwarded-for') }, 'invalid api key');
        return jsonError(401, 'unauthorized', 'Invalid API key', requestId);
      }
      if (!authService.checkScopes(key, options.scopes)) {
        return jsonError(403, 'forbidden', 'Insufficient scope', requestId);
      }

      const { rl, denied } = await enforceApiKeyRateLimit(key.id, requestId, log);
      if (denied) return denied;

      const ctx: ApiContext = {
        requestId,
        logger: log,
        apiKey: { id: key.id, name: key.name, scopes: key.scopes },
      };
      const res = await handler(req, ctx);
      stampRequestId(res, requestId);
      stampRateLimitHeaders(res, rl);
      return res;
    } catch (err) {
      return handleError(err, requestId, log);
    }
  };
}

/**
 * Accept EITHER a logged-in session OR a valid API key. Used by the
 * dual-mode endpoints in `/api/v1/sites/*` so the dashboard can call them
 * cookie-authenticated and Agents can call them with a Bearer key.
 *
 * Order: try session first (free cookie read), fall back to API key. If a
 * key is presented but invalid we still return 401 (don't silently allow).
 */
export function withAuth(handler: ApiHandler, options: WithApiKeyOptions = {}) {
  return async (req: NextRequest): Promise<Response> => {
    const requestId = getOrCreateRequestId(req.headers);
    const log = bindLogger(req, requestId);
    try {
      const session = await auth();
      const sUser = session?.user;
      if (sUser?.id) {
        const ctx: ApiContext = {
          requestId,
          logger: log,
          user: {
            id: sUser.id,
            email: sUser.email ?? '',
            name: sUser.name ?? null,
          },
        };
        const res = await handler(req, ctx);
        stampRequestId(res, requestId);
        return res;
      }

      const header = req.headers.get('authorization') ?? '';
      const match = /^Bearer\s+(.+)$/i.exec(header);
      if (!match) {
        return jsonError(401, 'unauthorized', 'Authentication required', requestId);
      }
      const plaintext = match[1]?.trim();
      if (!plaintext) {
        return jsonError(401, 'unauthorized', 'Authentication required', requestId);
      }
      const key = await authService.verifyApiKey(getDb(), plaintext);
      if (!key) {
        return jsonError(401, 'unauthorized', 'Invalid API key', requestId);
      }
      if (!authService.checkScopes(key, options.scopes)) {
        return jsonError(403, 'forbidden', 'Insufficient scope', requestId);
      }
      const { rl, denied } = await enforceApiKeyRateLimit(key.id, requestId, log);
      if (denied) return denied;
      const ctx: ApiContext = {
        requestId,
        logger: log,
        apiKey: { id: key.id, name: key.name, scopes: key.scopes },
      };
      const res = await handler(req, ctx);
      stampRequestId(res, requestId);
      stampRateLimitHeaders(res, rl);
      return res;
    } catch (err) {
      return handleError(err, requestId, log);
    }
  };
}

/** Convenience: standard success body envelope per docs/04-api-spec.md.
 * Routes that only need to return `{ data, meta? }` should use this so the
 * envelope shape stays consistent.
 */
export function ok<T>(
  data: T,
  init?: {
    meta?: Record<string, unknown>;
    requestId?: string;
    status?: number;
  },
): NextResponse {
  const body: { data: T; meta?: Record<string, unknown> } = { data };
  if (init?.meta) body.meta = init.meta;
  const res = NextResponse.json(body, { status: init?.status ?? 200 });
  if (init?.requestId) res.headers.set('x-request-id', init.requestId);
  return res;
}

/**
 * Read the JSON body off a `Request` without consuming the underlying stream.
 * Returns `null` on non-JSON / empty bodies. Used by the audited wrapper to
 * capture the input payload before the handler sees it.
 */
async function readJsonClone(req: Request): Promise<unknown> {
  const ct = req.headers.get('content-type') ?? '';
  if (!ct.toLowerCase().includes('application/json')) return null;
  try {
    const clone = req.clone();
    const text = await clone.text();
    if (text.length === 0) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Read the JSON body off a `Response` clone for audit logging. Errors are
 * swallowed and reported as `null` — audit must never fail the request.
 */
async function readJsonResponseClone(res: Response): Promise<unknown> {
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.toLowerCase().includes('application/json')) return null;
  try {
    const clone = res.clone();
    const text = await clone.text();
    if (text.length === 0) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function toLogObject(v: unknown): Record<string, unknown> | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'object') return { value: v };
  if (Array.isArray(v)) return { items: v };
  return v as Record<string, unknown>;
}

export type AuditedKeyOptions = WithApiKeyOptions & {
  /** Stable `noun.verb` identifier persisted on `agent_runs.action`. */
  action: string;
  /**
   * Resolver for `agent_runs.agent_name`. Defaults to:
   *   `x-agent-name` header → `?agent=` query → `api_key.name`.
   * Override when an action needs to record (e.g.) the task `kind`.
   */
  agentNameFrom?: (req: NextRequest, key: AuthedApiKey) => string;
  /**
   * Transform / strip the request body before it lands in `agent_runs.input`.
   * Defaults to "the full JSON body" when `content-type: application/json`
   * is supplied, otherwise `null`.
   */
  inputFrom?: (body: unknown, req: NextRequest) => unknown;
};

/**
 * Bearer-key wrapper that transparently records every call to `agent_runs`.
 *
 * Recording semantics:
 *   - `status='success'` when the handler returns a response with `status < 400`
 *   - `status='failed'` when the handler returns `>= 400` OR throws
 *   - `input`  captured from the JSON body (cloned, never consuming the original stream)
 *   - `output` captured from the response JSON (or `{ error: message }` on throw)
 *   - `duration_ms` measured via `process.hrtime.bigint`
 *   - **Audit write is fire-and-forget**: a DB failure logs `warn` but never
 *     alters the upstream caller's response or exception.
 *
 * Drop-in replacement for `withApiKey`: existing callers add the `action` field
 * and otherwise keep the same options shape.
 */
export function withApiKeyAudited(handler: ApiHandler, options: AuditedKeyOptions) {
  return withApiKey(async (req, ctx) => {
    const apiKey = ctx.apiKey;
    if (!apiKey) {
      // Defensive: withApiKey() never invokes us without a key. Falling
      // through without recording avoids a spurious "null api_key_id" row.
      return handler(req, ctx);
    }

    const startedNs = process.hrtime.bigint();
    const rawBody = await readJsonClone(req);
    const input = options.inputFrom ? options.inputFrom(rawBody, req) : rawBody;
    const agentName = options.agentNameFrom
      ? options.agentNameFrom(req, apiKey)
      : req.headers.get('x-agent-name') ||
        new URL(req.url).searchParams.get('agent') ||
        apiKey.name;

    let res: Response;
    let status: 'success' | 'failed' = 'success';
    let outputForLog: unknown = null;
    try {
      res = await handler(req, ctx);
      if (res.status >= 400) status = 'failed';
      outputForLog = await readJsonResponseClone(res);
    } catch (err) {
      status = 'failed';
      outputForLog = { error: err instanceof Error ? err.message : String(err) };
      void agentsSvc.agentRunService
        .record(
          { db: getDb(), logger: ctx.logger },
          {
            apiKeyId: apiKey.id,
            agentName,
            action: options.action,
            input: toLogObject(input),
            output: toLogObject(outputForLog),
            status,
            durationMs: Number((process.hrtime.bigint() - startedNs) / 1_000_000n),
          },
        )
        .catch((recErr) =>
          ctx.logger.warn(
            {
              event: 'agent_run.record_failed',
              action: options.action,
              err: { message: recErr instanceof Error ? recErr.message : String(recErr) },
            },
            'agent-run record failed (handler threw)',
          ),
        );
      throw err;
    }

    void agentsSvc.agentRunService
      .record(
        { db: getDb(), logger: ctx.logger },
        {
          apiKeyId: apiKey.id,
          agentName,
          action: options.action,
          input: toLogObject(input),
          output: toLogObject(outputForLog),
          status,
          durationMs: Number((process.hrtime.bigint() - startedNs) / 1_000_000n),
        },
      )
      .catch((recErr) =>
        ctx.logger.warn(
          {
            event: 'agent_run.record_failed',
            action: options.action,
            err: { message: recErr instanceof Error ? recErr.message : String(recErr) },
          },
          'agent-run record failed (handler returned)',
        ),
      );
    return res;
  }, options);
}

export { AppError };
