/**
 * `Idempotency-Key` HTTP middleware (T37).
 *
 * Implements the contract sketched in `docs/04-api-spec.md` §1 / §9:
 * a client retrying the same unsafe write (`POST`/`PUT`/`PATCH`) with the
 * same `Idempotency-Key` header sees the first response replayed instead
 * of the handler running again, so duplicate sites / deployments / tasks
 * are not created when the network or the client retries flakily.
 *
 * Boundary choices:
 *
 *   1. **Scoping**: cache key is namespaced by `principalKind:principalId`
 *      so two callers cannot collide on a guessable key, and also by
 *      `method:path` so the same key cannot accidentally match a `POST` and
 *      a `PATCH` to the same resource — they have different semantics.
 *   2. **Body hash**: SHA-256 over the raw request body text is stored
 *      alongside the response. A retry with the same key but a different
 *      body returns `422 idempotency_conflict` — this is what an Agent
 *      restart with mutated input looks like, and silently replaying the
 *      stale answer would hide the bug.
 *   3. **TTL**: 24h, matching the Stripe / IETF draft default. Long enough
 *      that retries spanning a deploy still dedupe, short enough that keys
 *      don't pile up.
 *   4. **5xx not cached**: server errors are presumed transient. The
 *      caller is expected to retry, and we want that retry to actually
 *      re-run the handler instead of hitting a stale 500. Anything `< 500`
 *      (including 4xx) IS cached — `400 validation_failed` deterministic
 *      retries should still get the same 400 back.
 *   5. **Redis is the single source of truth**. If Redis is down we fail
 *      open: handlers run, but we don't try to cache responses we can't
 *      read back. This is the same posture as the rate-limit fallback
 *      (T31): better to process the duplicate than to refuse all writes
 *      during a Redis outage.
 *
 * The wrapper in `with-api.ts` is the only intended caller; the export
 * surface here is shaped around that integration.
 */
import { AppError } from '@siteops/shared';
import { sha256Hex } from '@siteops/shared';

import { getLogger } from './logger';
import { getRedis } from './redis';

const REDIS_PREFIX = 'idem:';
const TTL_SEC = 24 * 60 * 60;
const KEY_MAX_LEN = 256;
/** Header values are URL-safe but we additionally forbid spaces / commas. */
const KEY_RE = /^[A-Za-z0-9._-]+$/;

/**
 * Subset of response headers we exclude when persisting an idempotent
 * response. These are per-request and would be misleading on replay —
 * e.g. `x-request-id` should reflect the replaying call, not the original,
 * and rate-limit headers must reflect the caller's *current* budget.
 */
const PER_REQUEST_HEADERS: ReadonlySet<string> = new Set([
  'x-request-id',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'retry-after',
  'date',
]);

/** Persisted shape of an idempotency cache entry. JSON-encoded in Redis. */
export type StoredResponse = {
  status: number;
  body: string;
  headers: Record<string, string>;
  /** SHA-256 hex over the raw request body. Conflict marker. */
  bodyHash: string;
  /** Wall-clock when the response was first cached (ms). For diagnostics. */
  createdAt: number;
};

/** Input bundle the wrapper hands to the idempotency layer. */
export type IdempotencyCtx = {
  idempotencyKey: string;
  method: string;
  path: string;
  /** Raw request body text — empty string is fine. */
  rawBody: string;
  principalKind: 'user' | 'api_key';
  principalId: string;
};

/**
 * Outcome of a cache lookup.
 *   - `replay`: caller should immediately return `buildReplayResponse(stored)`.
 *   - `proceed`: caller runs the handler and pipes the response through
 *     `save()` (fire-and-forget; never blocks the response on a cache hit).
 */
export type IdempotencyOutcome =
  | { kind: 'replay'; stored: StoredResponse }
  | { kind: 'proceed'; save: (res: Response) => Promise<void> };

/** Methods for which the wrapper honours an `Idempotency-Key` header. */
export function isIdempotentMethod(method: string): boolean {
  return method === 'POST' || method === 'PUT' || method === 'PATCH';
}

/**
 * Validate a header value. Throws an `AppError(400, validation_failed)`
 * which the wrapper's existing error handler translates to the canonical
 * JSON error envelope.
 */
export function assertValidIdempotencyKey(key: string): void {
  if (key.length === 0 || key.length > KEY_MAX_LEN || !KEY_RE.test(key)) {
    throw new AppError(`Idempotency-Key must be 1..${KEY_MAX_LEN} chars of [A-Za-z0-9._-]`, {
      code: 'validation_failed',
      status: 400,
      details: { header: 'idempotency-key' },
    });
  }
}

function redisKey(ctx: IdempotencyCtx): string {
  return `${REDIS_PREFIX}${ctx.principalKind}:${ctx.principalId}:${ctx.method}:${ctx.path}:${ctx.idempotencyKey}`;
}

/**
 * Check the cache for a prior response.
 *
 * Throws `idempotency_conflict (422)` only when a hit exists but the body
 * hash differs; that's a real client bug and we want them to see it.
 * Everything else (Redis errors, malformed cache rows) degrades open.
 */
export async function checkIdempotency(ctx: IdempotencyCtx): Promise<IdempotencyOutcome> {
  const log = getLogger();
  const key = redisKey(ctx);
  const bodyHash = sha256Hex(ctx.rawBody);

  let cached: string | null = null;
  try {
    const redis = getRedis();
    if (redis.status === 'wait' || redis.status === 'end') {
      await redis.connect().catch(() => undefined);
    }
    cached = await redis.get(key);
  } catch (err) {
    log.warn(
      {
        event: 'idempotency.lookup_failed',
        err: { message: err instanceof Error ? err.message : String(err) },
      },
      'idempotency cache lookup failed; degrading open',
    );
    // Fail open: we can't read or write the cache, so let the handler run
    // and skip persistence too. A handler-side dedupe (e.g. tasks
    // `dedupe_key`) is still in play as a second line of defence.
    return { kind: 'proceed', save: async () => undefined };
  }

  if (cached) {
    let stored: StoredResponse;
    try {
      stored = JSON.parse(cached) as StoredResponse;
    } catch {
      log.warn(
        { event: 'idempotency.parse_failed', key },
        'unparseable cached idempotency record; ignoring and re-running handler',
      );
      return { kind: 'proceed', save: makeSaver(key, bodyHash) };
    }
    if (stored.bodyHash !== bodyHash) {
      throw new AppError('Idempotency-Key reused with a different request body', {
        code: 'idempotency_conflict',
        status: 422,
        details: { header: 'idempotency-key' },
      });
    }
    return { kind: 'replay', stored };
  }

  return { kind: 'proceed', save: makeSaver(key, bodyHash) };
}

/**
 * Build the deferred saver. Captures response body + non-per-request
 * headers and persists them with the bound `bodyHash`. Errors are
 * swallowed — failing to cache must never fail the upstream request.
 */
function makeSaver(key: string, bodyHash: string): (res: Response) => Promise<void> {
  return async (res) => {
    if (res.status >= 500) return;
    try {
      const text = await res.clone().text();
      const headers: Record<string, string> = {};
      res.headers.forEach((value, name) => {
        const lower = name.toLowerCase();
        if (PER_REQUEST_HEADERS.has(lower)) return;
        headers[lower] = value;
      });
      const stored: StoredResponse = {
        status: res.status,
        body: text,
        headers,
        bodyHash,
        createdAt: Date.now(),
      };
      const redis = getRedis();
      if (redis.status === 'wait' || redis.status === 'end') {
        await redis.connect().catch(() => undefined);
      }
      await redis.setex(key, TTL_SEC, JSON.stringify(stored));
    } catch (err) {
      getLogger().warn(
        {
          event: 'idempotency.save_failed',
          err: { message: err instanceof Error ? err.message : String(err) },
        },
        'idempotency cache save failed; ignored',
      );
    }
  };
}

/**
 * Reconstruct a response from a cache hit. The wrapper layers
 * `x-request-id` / `x-ratelimit-*` on top so they reflect this call.
 */
export function buildReplayResponse(stored: StoredResponse): Response {
  const headers = new Headers();
  for (const [name, value] of Object.entries(stored.headers)) {
    headers.set(name, value);
  }
  headers.set('idempotent-replay', 'true');
  return new Response(stored.body, { status: stored.status, headers });
}
