/**
 * Locale switching smoke test (T28 acceptance).
 *
 * Verifies that:
 *   1. After login with **no** locale cookie, the dashboard defaults to
 *      zh-CN ("概览" sidebar / "概览" heading).
 *   2. Clicking the top-bar globe → "English" flips the entire dashboard
 *      to en-US ("Overview" heading) without a hard reload.
 *   3. After the flip, `siteops_locale=en-US` is persisted as a cookie
 *      so a subsequent hard reload keeps the UI in English.
 *
 * The locale switcher lives inside `(dashboard)/layout.tsx`, so we must
 * sign in first; the `/login` page intentionally has no switcher.
 */
import { expect, test, type Page } from '@playwright/test';

const ADMIN_EMAIL =
  process.env['E2E_ADMIN_EMAIL'] ?? process.env['ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD =
  process.env['E2E_ADMIN_PASSWORD'] ?? process.env['ADMIN_PASSWORD'] ?? 'ChangeMe123!';

// Ensure no locale cookie carries over from other specs, and pin the browser
// `Accept-Language` to `zh-CN` so the middleware's no-cookie negotiation lands
// on the zh-CN catalog (otherwise Chromium's default `en-US` short-circuits
// the very thing this test is meant to verify).
test.use({
  storageState: { cookies: [], origins: [] },
  locale: 'zh-CN',
});

async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.locator('input[name="email"]').fill(ADMIN_EMAIL);
  await page.locator('input[name="password"]').fill(ADMIN_PASSWORD);
  // The login button label is locale-dependent; match either variant.
  await page.getByRole('button', { name: /^(sign in|登录)$/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
}

test('dashboard defaults to zh-CN and the topbar switcher flips it to en-US', async ({
  page,
  context,
}) => {
  await signIn(page);

  // 1. Default locale is zh-CN — the Overview heading renders as "概览".
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '概览', level: 1 })).toBeVisible();

  // 2. Click the globe button (its aria-label starts with "切换语言").
  await page.getByRole('button', { name: /^(切换语言|switch language)/i }).click();
  await page.getByRole('menuitem', { name: 'English' }).click();

  // After `router.refresh()`, the heading should now be the en-US copy.
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible({
    timeout: 15_000,
  });

  // 3. Cookie persists.
  const cookies = await context.cookies();
  const localeCookie = cookies.find((c) => c.name === 'siteops_locale');
  expect(localeCookie?.value).toBe('en-US');

  // Hard reload to make sure the en-US copy isn't just an in-memory React state.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();
});
