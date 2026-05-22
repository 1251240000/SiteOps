/**
 * Per-process fixed-window counter (T31).
 *
 * Used as a fallback when Redis is unreachable so the rate-limit and
 * webhook bad-signature paths can still throttle abuse on a single
 * instance instead of failing wide open.
 *
 * Semantics
 * ---------
 * - Each `key` maps to a bucket `{ count, resetAt }`. The first hit in a
 *   window arms `resetAt = now + windowSec * 1000`; subsequent hits in
 *   the same window increment `count`.
 * - When `now >= resetAt`, the next hit re-arms the bucket from zero.
 * - `allowed = count <= limit`. The bucket keeps incrementing past `limit`
 *   so the caller can log "tried 23 times, capped at 5".
 *
 * Implementation
 * --------------
 * - `LRUCache(max=10_000)` so a flood of unique keys can't OOM the
 *   process; oldest buckets get evicted, and any attacker driving unique
 *   keys ends up just resetting their own counter (no advantage).
 * - All-in-process: when the app runs as multiple replicas, each replica
 *   counts independently. That's deliberate — see
 *   `tasks/M7-hardening/T31-rate-limit-degraded.md` "安全权衡".
 */
import { LRUCache } from 'lru-cache';

export type LocalWindowResult = {
  count: number;
  allowed: boolean;
  /** Wall-clock ms at which the bucket will reset on the next hit. */
  resetAtMs: number;
};

const DEFAULT_MAX_BUCKETS = 10_000;

type Bucket = { count: number; resetAt: number };

const buckets = new LRUCache<string, Bucket>({ max: DEFAULT_MAX_BUCKETS });

/**
 * Record one hit against `key` in a `windowSec`-second window with the
 * given `limit`. Returns the post-increment count and whether the caller
 * should still be allowed through.
 */
export function localHit(key: string, windowSec: number, limit: number): LocalWindowResult {
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowSec * 1000;
    buckets.set(key, { count: 1, resetAt });
    return { count: 1, allowed: 1 <= limit, resetAtMs: resetAt };
  }
  existing.count += 1;
  // Re-set so LRU recency is updated (without resetting the window).
  buckets.set(key, existing);
  return {
    count: existing.count,
    allowed: existing.count <= limit,
    resetAtMs: existing.resetAt,
  };
}

/** Test-only: drop every bucket so each test starts fresh. */
export function __resetLocalWindowForTests(): void {
  buckets.clear();
}

/** Test-only: peek without mutating. Useful for assertions. */
export function __peekLocalWindowForTests(key: string): Bucket | undefined {
  return buckets.peek(key);
}
