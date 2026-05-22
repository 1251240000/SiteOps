/**
 * Process-wide LRU cache for API-key bearer auth (T30).
 *
 * `verifyApiKey` is hot: at the default 600 req/min limit, a single key can
 * burn ~100ms of bcrypt CPU per second. The cache short-circuits the bcrypt
 * compare for 60 s on success, dropping CPU to "one bcrypt per minute per
 * active key" in the steady state.
 *
 * Invariants
 * ----------
 * - Keys are stored as `sha256(plaintext)`. We never keep plaintext in
 *   memory beyond the call that produced the cache miss.
 * - Each entry carries the row's `expiresAt`; `get()` self-evicts when the
 *   wall clock is past the expiry, so the cache can never extend a key's
 *   lifetime beyond what the DB says.
 * - `revoke` paths must call `invalidateById(id)`; otherwise a freshly
 *   revoked key would remain accepted for up to 60 s.
 * - Per-process only: web replicas don't share state. That's intentional;
 *   sharing via Redis would cost a network round-trip per verify and
 *   defeat the whole point.
 */
import { createHash } from 'node:crypto';

import { LRUCache } from 'lru-cache';

import type { AuthenticatedApiKey } from './auth-service.js';

export type ApiKeyCacheEntry = {
  apiKey: AuthenticatedApiKey;
  /** Mirrors `api_keys.expires_at` so a cache hit can re-check expiry. */
  expiresAt: Date | null;
  /** Mirrors `api_keys.id`; used by `invalidateById` to evict on revoke. */
  id: string;
};

export type ApiKeyCacheStats = {
  hits: number;
  misses: number;
  sets: number;
  invalidations: number;
};

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_MAX_ENTRIES = 1024;

const cache = new LRUCache<string, ApiKeyCacheEntry>({
  max: DEFAULT_MAX_ENTRIES,
  ttl: DEFAULT_TTL_MS,
});

const stats: ApiKeyCacheStats = { hits: 0, misses: 0, sets: 0, invalidations: 0 };

function hashKey(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

export const apiKeyCache = {
  /** Returns a non-expired entry, or `undefined` on miss / expired entry. */
  get(plaintext: string): ApiKeyCacheEntry | undefined {
    const k = hashKey(plaintext);
    const entry = cache.get(k);
    if (!entry) {
      stats.misses += 1;
      return undefined;
    }
    if (entry.expiresAt && entry.expiresAt.getTime() <= Date.now()) {
      // Self-evict: DB-side expiry has overtaken the TTL window.
      cache.delete(k);
      stats.misses += 1;
      return undefined;
    }
    stats.hits += 1;
    return entry;
  },

  /** Insert / replace an entry. Caller has already done bcrypt verification. */
  set(plaintext: string, entry: ApiKeyCacheEntry): void {
    cache.set(hashKey(plaintext), entry);
    stats.sets += 1;
  },

  /**
   * Evict every entry that maps to the given api-keys.id. Linear scan over
   * at most `DEFAULT_MAX_ENTRIES` rows; called on revoke, which is
   * admin-frequency. Returns the number of evicted entries.
   */
  invalidateById(id: string): number {
    let removed = 0;
    for (const [key, value] of cache.entries()) {
      if (value.id === id) {
        cache.delete(key);
        removed += 1;
      }
    }
    if (removed > 0) stats.invalidations += removed;
    return removed;
  },

  /** Drop every entry. Test-only / for emergency operational use. */
  clear(): void {
    cache.clear();
  },

  /** Snapshot of internal counters; safe to call from anywhere. */
  stats(): ApiKeyCacheStats {
    return { ...stats };
  },

  /** Test-only. Resets the counters but leaves entries intact. */
  resetStats(): void {
    stats.hits = 0;
    stats.misses = 0;
    stats.sets = 0;
    stats.invalidations = 0;
  },

  /** For test introspection: how many live entries are present right now. */
  size(): number {
    return cache.size;
  },
};
