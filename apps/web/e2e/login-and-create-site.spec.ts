/**
 * Smoke-level happy-path for the dashboard.
 *
 * Verifies that an admin can:
 *   1. Reach the login page via the middleware redirect from `/`
 *   2. Sign in with credentials seeded by `pnpm db:seed`
 *   3. Land on the dashboard, navigate to /sites/new, create a site
 *   4. See the new site in the /sites list
 *
 * The site name is randomized so successive runs don't collide on the
 * unique slug constraint (the dev DB is not reset between runs).
 *
 * The locale cookie is pinned to `en-US` for stability — the i18n catalogs
 * (T28) make zh-CN the default UI language, but this suite asserts on
 * English copy so the older fixtures keep working without rewrite.
 */
import { expect, test } from '@playwright/test';

const ADMIN_EMAIL =
  process.env['E2E_ADMIN_EMAIL'] ?? process.env['ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD =
  process.env['E2E_ADMIN_PASSWORD'] ?? process.env['ADMIN_PASSWORD'] ?? 'ChangeMe123!';

test.beforeEach(async ({ context, baseURL }) => {
  // Pin the dashboard to English so this assertion suite (which still uses
  // English copy) doesn't have to mirror every catalog change.
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

test('@smoke admin can log in, create a site, and see it in the registry', async ({ page }) => {
  const stamp = Date.now().toString(36);
  const siteName = `E2E Demo ${stamp}`;
  const slugStem = `e2e-demo-${stamp}`;
  const primaryUrl = `https://${slugStem}.example.com`;

  // 1. Middleware should bounce an unauthenticated visitor to the login page.
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { name: /sign in to siteops/i })).toBeVisible();

  // 2. Sign in.
  await page.locator('input[name="email"]').fill(ADMIN_EMAIL);
  await page.locator('input[name="password"]').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });

  // 3. Navigate to /sites and create a new site.
  await page.goto('/sites');
  await expect(page.getByRole('heading', { name: 'Sites' })).toBeVisible();
  await page.getByRole('link', { name: /new site/i }).click();
  await expect(page).toHaveURL(/\/sites\/new$/);

  await page.locator('input[name="name"]').fill(siteName);
  await page.locator('input[name="primaryUrl"]').fill(primaryUrl);
  await page.getByRole('button', { name: /create|save/i }).click();

  // After create the user is bounced to the new site's detail page.
  await page.waitForURL(/\/sites\/[0-9a-f-]{36}/, { timeout: 30_000 });
  // The detail page renders the name in three places (h1 header, card title,
  // success toast). Pin to the page heading for an unambiguous match.
  await expect(page.getByRole('heading', { name: siteName, level: 1 })).toBeVisible();

  // 4. Site is visible in the registry list.
  await page.goto('/sites');
  await expect(page.getByRole('link', { name: siteName })).toBeVisible();
});
