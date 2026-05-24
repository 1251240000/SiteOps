import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 15_000,
    // T50 — `shared` is mostly Zod schemas, pure helpers, and constants.
    // Schemas are exercised transitively by their consumers
    // (`@siteops/services`, `@siteops/web`); instrumenting them in *this*
    // package's report would dilute the signal. The `include` below
    // therefore scopes coverage to the categories that `shared`'s own unit
    // tests own — utilities, date helpers, and the error mapper.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/utils/**/*.ts', 'src/date/**/*.ts', 'src/errors.ts'],
      exclude: [
        '**/*.test.ts',
        '**/__tests__/**',
        '**/__fixtures__/**',
        '**/*.d.ts',
        'src/**/index.ts',
      ],
      thresholds: {
        lines: 70,
        statements: 70,
        functions: 70,
        branches: 55,
      },
    },
  },
});
