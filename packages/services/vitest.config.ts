import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Auth-service tests boot PGlite via `@siteops/db/testing` AND drive
    // real bcrypt rounds (the api-key cap test seeds 50 keys at cost=12 ≈
    // 12s standalone). With `vitest --coverage` instrumentation **and** the
    // turbo parallel runner contending for CPU across all four workspace
    // suites, that single test can stretch past a minute. 120s gives all
    // of that headroom without masking truly stuck tests.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // T50 — `services` is the business-logic core. Aspirational target per
    // the task spec is 75% lines; current floor is 60% because several large
    // services (alert-service, audit-service, error-service, gh-service,
    // gsc-service) are exercised through their HTTP route handlers in
    // `apps/web/__tests__/` rather than via direct unit tests here. Bump the
    // floor as new service-level tests land — never lower without an
    // explicit task.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/__tests__/**',
        '**/__fixtures__/**',
        '**/*.d.ts',
        // Aggregator re-exports (zero executable lines) drag the average
        // down without adding signal.
        'src/**/index.ts',
      ],
      thresholds: {
        lines: 60,
        statements: 60,
        functions: 75,
        branches: 65,
      },
    },
  },
});
