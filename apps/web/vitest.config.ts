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
 *
 * Coverage (T50):
 *   - v8 provider; html + json-summary reports so CI can upload the artifact
 *     and humans can browse it locally (`open coverage/index.html`).
 *   - `include` is scoped to server-side modules we actually unit-test;
 *     untested route handlers / React components would otherwise drag the
 *     denominator down to noise and force us to chase coverage on things
 *     that are intentionally covered by Playwright (`apps/web/e2e`).
 *   - Thresholds reflect what the unit suite is responsible for. Bump them
 *     as we add tests; do **not** lower without an explicit T-task.
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
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: './coverage',
      // Restrict the universe to the request/response and i18n helpers that
      // unit tests actually own. Code that lives outside this surface is
      // covered elsewhere:
      //   - UI components, pages, middleware  → Playwright (`apps/web/e2e/`)
      //   - API route handlers                → Playwright + a few focused
      //                                        `__tests__/` route specs
      //   - `lib/openapi/*`                   → static schema definitions run
      //                                        by `pnpm openapi:generate` and
      //                                        diffed by `openapi:check` in CI
      //   - `lib/queries/*`                   → React Query thin wrappers,
      //                                        exercised by Playwright
      // Without this scope the report would drag in untested generators and
      // query hooks and bury real regressions in noise.
      include: ['lib/*.ts', 'lib/i18n/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/__tests__/**',
        '**/__fixtures__/**',
        '**/*.d.ts',
      ],
      thresholds: {
        lines: 60,
        statements: 60,
        functions: 60,
        branches: 50,
      },
    },
  },
});
