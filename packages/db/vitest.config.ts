import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // PGlite boots a WASM Postgres per `createTestDb()`; first run is ~1–2s.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // T50 — most of `db` is Drizzle table definitions + thin repository
    // helpers. The repository helpers carry the bulk of the logic, so the
    // include below scopes coverage to `repositories/`.
    //
    // Several repos (api-key, audit, alert, integration-credential / -state,
    // metrics, user, user-invitation) are deliberately exercised by
    // `@siteops/services` integration tests rather than direct unit tests
    // here. That pulls the line average down to ~50%; we hold the floor at
    // 45% so a regression that deletes any tested repo still fails CI, but
    // we don't pretend the un-direct-tested repos are 100% covered locally.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/repositories/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/__tests__/**',
        '**/__fixtures__/**',
        '**/*.d.ts',
        'src/**/index.ts',
      ],
      thresholds: {
        lines: 45,
        statements: 45,
        functions: 70,
        branches: 65,
      },
    },
  },
});
