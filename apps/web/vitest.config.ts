import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * Vitest config for `apps/web`.
 *
 * - `tsconfigPaths()` mirrors the `@/*` aliases declared in `tsconfig.json`
 *   so route-handler tests can import `@/lib/...` the same way the
 *   production code does (and `vi.mock('@/lib/auth')` resolves to the same
 *   module id as the relative imports inside `lib/with-api.ts`).
 * - Uses Node environment because we exercise API route handlers (which run
 *   server-side) and PGlite via `@siteops/db/testing`.
 * - Excludes the `e2e/` Playwright suite, which has its own runner.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['app/**/*.test.ts', 'lib/**/*.test.ts', '__tests__/**/*.test.ts'],
    exclude: ['node_modules', '.next', 'dist', 'e2e'],
    // PGlite WASM compile takes 1–2s cold; bump generously so we don't
    // flake when turbo runs other workspace tests on the same box.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Stub the env vars `lib/env.ts` validates. Tests mock `getDb()` so the
    // strings are never used to open a real connection — they just have to
    // satisfy Zod (`z.string().url()`).
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://test:test@localhost:5432/test',
      REDIS_URL: 'redis://localhost:6379',
      AUTH_SECRET: 'vitest-secret-not-real',
      LOG_LEVEL: 'fatal',
    },
  },
});
