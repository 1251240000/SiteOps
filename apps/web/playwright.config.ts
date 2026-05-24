import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for `apps/web`.
 *
 * Boots the Next.js dev server on a dedicated port (3100) so a developer can
 * keep `pnpm dev` running on 3000 without conflict. CI sets `CI=1` and reuses
 * the same port via `--reuse-existing-server=false`.
 *
 * Pre-conditions assumed by the spec(s):
 *   - Postgres + Redis reachable at the URLs below
 *   - `pnpm db:migrate` has been run
 *   - An admin user exists with the credentials in `E2E_ADMIN_*`
 *
 * The `e2e` GitHub Actions workflow handles all three before invoking
 * `pnpm test:e2e`. Locally, run `pnpm dev:up && pnpm db:migrate && pnpm db:seed`
 * once before the first run.
 *
 * Projects:
 *   - `chromium` — full suite, runs every spec under `e2e/`. Used by the
 *     nightly `e2e.yml` workflow and any local `pnpm test:e2e` invocation.
 *   - `smoke` — same browser, but `grep`-filtered to specs tagged `@smoke`.
 *     Used by the per-PR `ci.yml` step `pnpm test:e2e:smoke` to keep the
 *     blocking signal under five minutes (T50). Tag a spec by adding `@smoke`
 *     to the test title, e.g. `test('@smoke admin can log in', ...)`.
 */

const PORT = Number(process.env['PORT'] ?? 3100);
const BASE_URL = process.env['E2E_BASE_URL'] ?? `http://127.0.0.1:${PORT}`;
const isCI = !!process.env['CI'];

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: 1,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'smoke',
      use: { ...devices['Desktop Chrome'] },
      // Subset of `chromium` filtered to specs whose title contains `@smoke`.
      // Run via `pnpm test:e2e:smoke` (--project=smoke).
      grep: /@smoke/,
    },
  ],
  webServer: {
    command: `pnpm dev`,
    url: BASE_URL,
    timeout: 120_000,
    reuseExistingServer: !isCI,
    env: {
      PORT: String(PORT),
      // Tests rely on the host-side DB / Redis URLs; fall through to
      // whatever the developer has in `.env.local` or the CI workflow.
      NODE_ENV: 'development',
    },
  },
});
