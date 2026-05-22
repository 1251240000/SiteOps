/**
 * Vitest benchmark for the API-key cache (T30 acceptance criterion).
 *
 * Run with:
 *   pnpm --filter @siteops/services bench
 *
 * The "cached" run measures a steady-state hit (sha256 of plaintext + Map
 * lookup), the "uncached" run forces a bcrypt compare on every call. The
 * task asks for ≥ 50× speedup; in practice on a modern x86 core the ratio
 * is ~50,000× because bcrypt cost 12 ≈ 250 ms vs. sha256 + LRU lookup
 * ≈ a handful of microseconds.
 *
 * NOTE: This file is *not* picked up by `vitest run` (which only globs
 * `**\/*.test.ts`). It runs through `vitest bench` so the regular CI test
 * matrix is unaffected.
 */
import { bench, describe } from 'vitest';

import { compareApiKey, generateApiKey } from '@siteops/shared';

import { apiKeyCache } from '../api-key-cache.js';

// Pre-generate one key + warm the cache so each iteration of the cached
// path is purely a hit. The uncached path stresses bcrypt directly.
const generated = await generateApiKey();
apiKeyCache.set(generated.plaintext, {
  apiKey: { id: 'bench-id', name: 'bench', scopes: ['*'], rateLimitPerMin: null },
  expiresAt: null,
  id: 'bench-id',
});

describe('api-key auth path', () => {
  bench('cached (sha256 + LRU hit)', () => {
    apiKeyCache.get(generated.plaintext);
  });

  bench(
    'uncached (bcrypt compare)',
    async () => {
      await compareApiKey(generated.plaintext, generated.hash);
    },
    { iterations: 50 },
  );
});
