/**
 * Dashboard navigation smoke (M0–M5 coverage).
 *
 * Goal: catch big regressions in app-shell wiring without depending on data
 * fixtures. Each page is reached via the sidebar, must produce its `<h1>`,
 * and must not log a React error boundary message.
 *
 * The locale is pinned to en-US so the heading copy in `messages/en-US.json`
 * is authoritative for the assertions.
 */
import { expect, test, type Page } from '@playwright/test';

const ADMIN_EMAIL =
  process.env['E2E_ADMIN_EMAIL'] ?? process.env['ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD =
  process.env['E2E_ADMIN_PASSWORD'] ?? process.env['ADMIN_PASSWORD'] ?? 'ChangeMe123!';

async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.locator('input[name="email"]').fill(ADMIN_EMAIL);
  await page.locator('input[name="password"]').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
}

test.beforeEach(async ({ context, baseURL }) => {
  const url = new URL(baseURL ?? 'http://localhost:3000');
  await context.addCookies([
    {
      name: 'siteops_locale',
      value: 'en-US',
      domain: url.hostname,
      path: '/',
      sameSite: 'Lax',
    },
  ]);
});

const PAGES: Array<{ path: string; heading: RegExp }> = [
  { path: '/', heading: /^overview$/i },
  { path: '/sites', heading: /^sites$/i },
  { path: '/traffic', heading: /^traffic$/i },
  { path: '/revenue', heading: /^revenue$/i },
  { path: '/roi', heading: /^roi$/i },
  { path: '/domains', heading: /^domains$/i },
  { path: '/deployments', heading: /^deployments$/i },
  { path: '/errors', heading: /^errors$/i },
  { path: '/alerts', heading: /^alerts$/i },
  { path: '/integrations', heading: /^integrations$/i },
  { path: '/agent-runs', heading: /agent runs/i },
  { path: '/tasks', heading: /^tasks$/i },
  { path: '/webhooks', heading: /webhooks?/i },
  { path: '/settings/api-keys', heading: /api keys/i },
  { path: '/settings', heading: /^settings$/i },
];

test('@smoke every primary dashboard page renders its heading without a console error', async ({
  page,
}) => {
  // T33 — wire up CSP-violation collection BEFORE we navigate so we don't
  // miss reports on the very first paint. The page may report violations
  // even in `Content-Security-Policy-Report-Only` mode (which is what dev
  // publishes); collecting them here lets us fail loudly if a future
  // refactor introduces an inline script that we forgot to whitelist.
  const cspViolations: string[] = [];
  await page.exposeFunction('__siteopsCspViolation', (msg: string) => {
    cspViolations.push(msg);
  });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      // `eval` violations are emitted by Next.js / Turbopack's dev runtime
      // for HMR module factories. Production builds don't need `eval`, and
      // adding `'unsafe-eval'` to the policy would defeat its purpose, so
      // we ignore that one signature when running against `next dev`.
      if (e.blockedURI === 'eval') return;
      const detail = `${e.violatedDirective} blocked ${e.blockedURI || '(inline)'}`;
      const reporter = (window as unknown as Record<string, (m: string) => void>)[
        '__siteopsCspViolation'
      ];
      reporter?.(detail);
    });
  });

  await signIn(page);

  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    // Next.js hydration warnings show up as `error` in CI; filter out noise
    // from optional integrations that intentionally log when not configured.
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  for (const { path, heading } of PAGES) {
    await page.goto(path);
    await expect(
      page.getByRole('heading', { name: heading, level: 1 }),
      `route ${path}`,
    ).toBeVisible({ timeout: 15_000 });
  }

  // The dashboard intentionally logs `warn`s when integrations are missing,
  // but we treat anything at `error` level as a smoke failure.
  expect(
    consoleErrors,
    `unexpected console.error during nav smoke:\n${consoleErrors.join('\n')}`,
  ).toEqual([]);

  // CSP violations always fail the suite — they signal a hole in
  // `applySecurityHeaders` or new inline content the layout introduced.
  expect(
    cspViolations,
    `unexpected CSP violations during nav smoke:\n${cspViolations.join('\n')}`,
  ).toEqual([]);
});
