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

import { auth as authService } from '@siteops/services';
import { AppError, isAppError } from '@siteops/shared';

import { auth } from './auth';
import { getDb } from './db';
import { getLogger, type Logger } from './logger';
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

      const ctx: ApiContext = {
        requestId,
        logger: log,
        apiKey: { id: key.id, name: key.name, scopes: key.scopes },
      };
      const res = await handler(req, ctx);
      stampRequestId(res, requestId);
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
      const ctx: ApiContext = {
        requestId,
        logger: log,
        apiKey: { id: key.id, name: key.name, scopes: key.scopes },
      };
      const res = await handler(req, ctx);
      stampRequestId(res, requestId);
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

export { AppError };
