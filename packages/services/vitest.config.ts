import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Auth-service tests boot PGlite via `@siteops/db/testing`; first run is
    // ~1–2s of WASM compilation, so give every test ample headroom.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
