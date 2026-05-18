/**
 * Webhook ingestion + replay orchestrator (T27).
 *
 * The route handler is a thin shell around `verifyAndIngest` — it builds
 * the input from the raw request and turns the result into an HTTP response.
 * Tests live next to this module so they can exercise the full pipeline
 * (sign → ingest → dispatch → mark) without going through Next.js.
 *
 * Design notes:
 *   - `signature_ok=false` rows are *still* persisted (audit), but only up
 *     to a per-IP / per-provider in-memory budget — see `BAD_SIG_BUCKET`.
 *   - `(provider, delivery_id)` is the idempotency anchor. A second
 *     delivery short-circuits with `duplicate=true` and **does not**
 *     re-run the dispatcher.
 *   - Dispatcher failures land in `webhook_events.error` and surface as
 *     `meta.dispatch_failed=true` in the response envelope. The webhook
 *     itself still acks `202` so the provider doesn't retry-storm us.
 */
import {
  webhookEventRepo,
  type Db,
  type WebhookEvent,
  type WebhookEventListOptions,
  type WebhookEventListPage,
  type WebhookProvider,
} from '@siteops/db';
import {
  AppError,
  cloudflareEventTypeSchema,
  githubEventTypeSchema,
  verifyGitHubSignature,
  verifyHmacSha256,
  WEBHOOK_BAD_SIG_WINDOW_MAX,
  WEBHOOK_BAD_SIG_WINDOW_MS,
  WEBHOOK_EVENT_RETENTION_DAYS,
  type CloudflareEventType,
  type GithubEventType,
  type Logger,
} from '@siteops/shared';

import { dispatchCloudflare } from './cloudflare-dispatch.js';
import { dispatchGithub } from './github-dispatch.js';

/**
 * Single-writer bucket used to throttle bad-signature storms. Implementations
 * must:
 *   - increment the count for `key` atomically
 *   - reset to 1 with a fresh `ttlSec` window when no entry exists OR the
 *     entry has expired
 *   - NEVER throw — outages must fail open (caller treats `over=false`)
 *
 * Two implementations are shipped:
 *   - `inMemoryBadSigBucket` (default): per-process Map; fine for single
 *     instance dev/test
 *   - the route layer in `apps/web` wraps a Redis client (production)
 */
export type BadSigBucket = {
  hit(key: string, ttlSec: number, cap: number): Promise<{ count: number; over: boolean }>;
  reset(): Promise<void>;
};

export type WebhookServiceDeps = {
  db: Db;
  logger?: Logger;
  /** Optional Redis-backed bucket. Falls back to the in-memory singleton. */
  badSigBucket?: BadSigBucket;
};

export type VerifyAndIngestInput = {
  provider: WebhookProvider;
  /** Provider-shared secret. `null` when not configured. */
  secret: string | null;
  /** Raw HTTP body string — used for HMAC. */
  rawBody: string;
  /** Provider-supplied signature header. */
  signature: string | null;
  /** Provider-supplied delivery id. Required: missing → 400. */
  deliveryId: string | null;
  /** Provider-supplied event type. */
  eventType: string | null;
  /** Best-effort client IP for the bad-signature rate limiter. */
  sourceIp?: string | null;
};

export type IngestStatusOutcome =
  /** stored signature_ok=false; route should return 401. */
  | { kind: 'unauthorized'; eventId: string | null }
  /** secret missing; route returns 503. */
  | { kind: 'not_configured' }
  /** delivery_id / event_type missing or payload not JSON; route returns 400. */
  | { kind: 'bad_request'; reason: string }
  /** signature rate limited; we drop without writing. route returns 401. */
  | { kind: 'rate_limited' }
  /** event was successfully ingested. */
  | {
      kind: 'accepted';
      event: WebhookEvent;
      duplicate: boolean;
      dispatchFailed: boolean;
      dispatchError?: string;
    };

/**
 * Default in-memory bucket. Module-singleton so multiple route invocations
 * within one process share the budget. Used in tests and as a graceful
 * fallback when a Redis-backed bucket isn't supplied via deps.
 */
type BadSigEntry = { resetAt: number; count: number };
const BAD_SIG_MEMORY_MAP = new Map<string, BadSigEntry>();
export const inMemoryBadSigBucket: BadSigBucket = {
  async hit(key, ttlSec, cap) {
    const now = Date.now();
    const entry = BAD_SIG_MEMORY_MAP.get(key);
    if (!entry || entry.resetAt <= now) {
      BAD_SIG_MEMORY_MAP.set(key, { resetAt: now + ttlSec * 1000, count: 1 });
      return { count: 1, over: 1 > cap };
    }
    entry.count += 1;
    return { count: entry.count, over: entry.count > cap };
  },
  async reset() {
    BAD_SIG_MEMORY_MAP.clear();
  },
};

function badSigKey(provider: WebhookProvider, ip: string | null | undefined): string {
  return `${provider}|${ip ?? 'unknown'}`;
}

/**
 * Returns `{ over: true }` when the (provider, ip) tuple has *just* exceeded
 * the cap. On every call this also bumps the count and lazily expires the
 * window. Uses the bucket on `deps.badSigBucket` if present (Redis in prod);
 * otherwise the per-process in-memory map.
 *
 * Failure mode: if the bucket impl throws, we *fail open* — duplicating the
 * decision the rate-limit helper makes for the API key path. Letting a
 * webhook through is far less bad than rejecting all of them when Redis is
 * down.
 */
export async function recordBadSignatureHit(
  deps: WebhookServiceDeps,
  provider: WebhookProvider,
  ip: string | null | undefined,
): Promise<boolean> {
  const bucket = deps.badSigBucket ?? inMemoryBadSigBucket;
  const key = badSigKey(provider, ip);
  try {
    const ttlSec = Math.max(1, Math.round(WEBHOOK_BAD_SIG_WINDOW_MS / 1000));
    const out = await bucket.hit(key, ttlSec, WEBHOOK_BAD_SIG_WINDOW_MAX);
    return out.over;
  } catch (err) {
    deps.logger?.warn(
      { err: { message: err instanceof Error ? err.message : String(err) }, key },
      'bad-sig bucket failed; failing open',
    );
    return false;
  }
}

/** Test escape hatch — clears the per-process bad-sig counter. */
export function __resetBadSignatureBucketForTests(): void {
  BAD_SIG_MEMORY_MAP.clear();
}

function verifyProviderSignature(
  provider: WebhookProvider,
  secret: string,
  rawBody: string,
  signature: string | null,
): boolean {
  if (!signature) return false;
  if (provider === 'github') return verifyGitHubSignature(secret, rawBody, signature);
  // Cloudflare ships the HMAC as plain hex in `cf-webhook-auth`.
  return verifyHmacSha256(secret, rawBody, signature.trim());
}

function normalizeCfEventType(input: string): CloudflareEventType | null {
  const parsed = cloudflareEventTypeSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

function normalizeGhEventType(input: string): GithubEventType | null {
  const parsed = githubEventTypeSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export const webhookService = {
  /**
   * Verify HMAC → idempotent insert → dispatch. The route turns the
   * `IngestStatusOutcome` into the appropriate HTTP status; see the type
   * for the exhaustive list of cases.
   */
  async verifyAndIngest(
    deps: WebhookServiceDeps,
    input: VerifyAndIngestInput,
  ): Promise<IngestStatusOutcome> {
    const { provider, secret, rawBody, signature, deliveryId, eventType, sourceIp } = input;

    if (!secret) return { kind: 'not_configured' };
    if (!deliveryId) return { kind: 'bad_request', reason: 'missing_delivery_id' };
    if (!eventType) return { kind: 'bad_request', reason: 'missing_event_type' };

    const signatureOk = verifyProviderSignature(provider, secret, rawBody, signature);

    // Cheap JSON parse first — we need the payload regardless of sig outcome
    // so we can persist it for audit.
    let payloadJson: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(rawBody);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { kind: 'bad_request', reason: 'payload_not_object' };
      }
      payloadJson = parsed as Record<string, unknown>;
    } catch {
      return { kind: 'bad_request', reason: 'invalid_json' };
    }

    if (!signatureOk) {
      // Rate-limit bad-sig storms before they hit the DB. The hit is recorded
      // *before* we decide because we want the counter to climb so subsequent
      // attempts hit the cap deterministically.
      const overLimit = await recordBadSignatureHit(deps, provider, sourceIp);
      if (overLimit) {
        deps.logger?.warn(
          { event: 'webhook.bad_sig_rate_limited', provider, ip: sourceIp ?? null },
          'webhook bad-signature flood dropped',
        );
        return { kind: 'rate_limited' };
      }

      const row = await webhookEventRepo.create(deps.db, {
        provider,
        eventType,
        deliveryId,
        signatureOk: false,
        payload: payloadJson,
      });
      // A duplicate delivery_id even on the bad-sig path is fine — we just
      // skip recording the second copy. The original row already exists.
      return { kind: 'unauthorized', eventId: row?.id ?? null };
    }

    // Signature ok — try to insert. Unique-violation → duplicate; return
    // the existing row without re-dispatching.
    const inserted = await webhookEventRepo.create(deps.db, {
      provider,
      eventType,
      deliveryId,
      signatureOk: true,
      payload: payloadJson,
    });
    if (!inserted) {
      const existing = await webhookEventRepo.findByDelivery(deps.db, provider, deliveryId);
      if (!existing) {
        // Catastrophic: row should be there after 23505 but isn't. Surface
        // an AppError so the route renders a 500 rather than ack-ing 202.
        throw new AppError('webhook delivery row disappeared after unique-violation', {
          code: 'internal_error',
          status: 500,
          details: { provider, deliveryId },
        });
      }
      return {
        kind: 'accepted',
        event: existing,
        duplicate: true,
        dispatchFailed: false,
      };
    }

    // Dispatch — failures are swallowed into the event row, not raised.
    let dispatchFailed = false;
    let dispatchError: string | undefined;
    let siteId: string | null = null;
    try {
      if (provider === 'cloudflare') {
        const cfType = normalizeCfEventType(eventType);
        if (!cfType) {
          dispatchFailed = true;
          dispatchError = `unhandled_event_type:${eventType}`;
        } else {
          const out = await dispatchCloudflare(
            { db: deps.db, ...(deps.logger ? { logger: deps.logger } : {}) },
            cfType,
            payloadJson,
          );
          if (out) siteId = out.siteId;
          else {
            dispatchFailed = true;
            dispatchError = 'site_not_resolved';
          }
        }
      } else {
        const ghType = normalizeGhEventType(eventType);
        if (!ghType) {
          dispatchFailed = true;
          dispatchError = `unhandled_event_type:${eventType}`;
        } else {
          const out = await dispatchGithub(
            { db: deps.db, ...(deps.logger ? { logger: deps.logger } : {}) },
            ghType,
            payloadJson,
          );
          siteId = out.siteId;
        }
      }
    } catch (err) {
      dispatchFailed = true;
      dispatchError = err instanceof Error ? err.message : String(err);
      deps.logger?.warn(
        {
          event: 'webhook.dispatch_failed',
          provider,
          deliveryId,
          err: { message: dispatchError },
        },
        'webhook dispatch failed',
      );
    }

    if (dispatchFailed) {
      const failed = await webhookEventRepo.markFailed(
        deps.db,
        inserted.id,
        dispatchError ?? 'unknown',
      );
      return {
        kind: 'accepted',
        event: failed ?? inserted,
        duplicate: false,
        dispatchFailed: true,
        ...(dispatchError ? { dispatchError } : {}),
      };
    }

    const processed = await webhookEventRepo.markProcessed(deps.db, inserted.id, {
      siteId,
    });
    return {
      kind: 'accepted',
      event: processed ?? inserted,
      duplicate: false,
      dispatchFailed: false,
    };
  },

  /**
   * Re-run dispatch for an already-persisted event. Signature is *not*
   * re-checked: the payload is loaded straight off the DB and trusted.
   * Caller is responsible for admin auth.
   */
  async replay(
    deps: WebhookServiceDeps,
    eventId: string,
  ): Promise<{ event: WebhookEvent; dispatchFailed: boolean; error?: string }> {
    const row = await webhookEventRepo.getById(deps.db, eventId);
    if (!row) {
      throw new AppError('webhook event not found', {
        code: 'not_found',
        status: 404,
        details: { id: eventId },
      });
    }
    if (!row.signatureOk) {
      throw new AppError('cannot replay a signature-failed delivery', {
        code: 'forbidden',
        status: 403,
        details: { id: eventId },
      });
    }

    let dispatchFailed = false;
    let dispatchError: string | undefined;
    let siteId: string | null = row.siteId ?? null;

    try {
      if (row.provider === 'cloudflare') {
        const cfType = normalizeCfEventType(row.eventType);
        if (!cfType) {
          dispatchFailed = true;
          dispatchError = `unhandled_event_type:${row.eventType}`;
        } else {
          const out = await dispatchCloudflare(
            { db: deps.db, ...(deps.logger ? { logger: deps.logger } : {}) },
            cfType,
            row.payload,
          );
          if (out) siteId = out.siteId;
          else {
            dispatchFailed = true;
            dispatchError = 'site_not_resolved';
          }
        }
      } else {
        const ghType = normalizeGhEventType(row.eventType);
        if (!ghType) {
          dispatchFailed = true;
          dispatchError = `unhandled_event_type:${row.eventType}`;
        } else {
          const out = await dispatchGithub(
            { db: deps.db, ...(deps.logger ? { logger: deps.logger } : {}) },
            ghType,
            row.payload,
          );
          siteId = out.siteId ?? siteId;
        }
      }
    } catch (err) {
      dispatchFailed = true;
      dispatchError = err instanceof Error ? err.message : String(err);
    }

    if (dispatchFailed) {
      const failed = await webhookEventRepo.markFailed(deps.db, row.id, dispatchError ?? 'unknown');
      return {
        event: failed ?? row,
        dispatchFailed: true,
        ...(dispatchError ? { error: dispatchError } : {}),
      };
    }
    const processed = await webhookEventRepo.markProcessed(deps.db, row.id, { siteId });
    return { event: processed ?? row, dispatchFailed: false };
  },

  /**
   * Admin list — straight pass-through to the repo. Kept on the service
   * surface so consumers don't have to import `@siteops/db` directly.
   */
  async list(
    deps: WebhookServiceDeps,
    opts: WebhookEventListOptions = {},
  ): Promise<WebhookEventListPage> {
    return webhookEventRepo.list(deps.db, opts);
  },

  /**
   * Housekeeping helper — delete processed rows older than `days`. We *keep*
   * `signature_ok=false` rows forever (the repo's prune already enforces
   * that); deleting them would erase the audit trail of attacks / misconfigs.
   *
   * Default retention follows `WEBHOOK_EVENT_RETENTION_DAYS` (90d).
   */
  async pruneOlderThan(
    deps: WebhookServiceDeps,
    days: number = WEBHOOK_EVENT_RETENTION_DAYS,
  ): Promise<number> {
    const deleted = await webhookEventRepo.pruneProcessedOlderThan(deps.db, days);
    if (deleted > 0) {
      deps.logger?.info({ event: 'webhook_event.pruned', deleted, days }, 'webhook events pruned');
    }
    return deleted;
  },
};
