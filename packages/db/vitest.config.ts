import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // PGlite boots a WASM Postgres per `createTestDb()`; first run is ~1–2s.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
