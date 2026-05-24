/**
 * T40 acceptance — invitation happy path.
 *
 * Verifies that:
 *   1. An admin can mint an invitation link from `/settings/users`
 *   2. The invitee can claim the link, set a password, and is auto-signed-in
 *   3. The new account lands on the dashboard with their own session
 *
 * Database state is **not** reset between runs (`pnpm db:seed` is one-shot
 * for the admin) so we mint a unique email per run and pin the locale to
 * en-US for stable assertions.
 */
import { expect, test, type Page } from '@playwright/test';

const ADMIN_EMAIL =
  process.env['E2E_ADMIN_EMAIL'] ?? process.env['ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD =
  process.env['E2E_ADMIN_PASSWORD'] ?? process.env['ADMIN_PASSWORD'] ?? 'ChangeMe123!';

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

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });
}

test('admin invites a viewer; invitee accepts and lands on the dashboard', async ({
  page,
  context,
}) => {
  const stamp = Date.now().toString(36);
  const inviteeEmail = `e2e-invitee-${stamp}@example.com`;
  const inviteeName = `E2E Invitee ${stamp}`;
  const inviteePassword = 'InvitePwd!23';

  // 1. Admin signs in and navigates to the team page.
  await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.goto('/settings/users');
  await expect(page.getByRole('heading', { name: 'Team', level: 1 })).toBeVisible();

  // 2. Open the invite dialog and submit a Viewer invitation.
  await page.getByRole('button', { name: /^invite user$/i }).click();
  await expect(page.getByRole('alertdialog', { name: /invite a teammate/i })).toBeVisible();
  await page.locator('#invite-email').fill(inviteeEmail);
  // Role dropdown defaults to "Viewer"; explicitly leave it as the default.
  await page.getByRole('button', { name: /^create invitation$/i }).click();

  // 3. The dialog flips to stage 2 — capture the invite URL. The Label
  //    isn't `htmlFor`-bound to the input, so we scope the lookup to the
  //    alert-dialog and grab the read-only textbox.
  const issuedDialog = page.getByRole('alertdialog', { name: /invitation created/i });
  await expect(issuedDialog).toBeVisible();
  const inviteUrl = await issuedDialog.getByRole('textbox').inputValue();
  expect(inviteUrl).toMatch(/\/invite\/[A-Za-z0-9_-]{20,}$/);

  // 4. Sign the admin out by wiping cookies in this context — the invitation
  //    page redirects authenticated users to `/`, so the invitee browser must
  //    start anonymous.
  await context.clearCookies();
  // Re-pin the locale cookie that beforeEach planted (clearCookies wiped it).
  const url = new URL(inviteUrl);
  await context.addCookies([
    {
      name: 'siteops_locale',
      value: 'en-US',
      domain: url.hostname,
      path: '/',
      sameSite: 'Lax',
    },
  ]);

  // 5. Visit the invitation link, fill in the acceptance form.
  await page.goto(inviteUrl);
  await expect(page.getByRole('heading', { name: /accept invitation/i })).toBeVisible();
  await page.locator('#name').fill(inviteeName);
  await page.locator('#password').fill(inviteePassword);
  await page.locator('#confirm').fill(inviteePassword);
  await page.getByRole('button', { name: /^create account$/i }).click();

  // 6. After accept + auto-signIn the invitee is bounced to `/`. The topbar
  //    user menu surfaces their name in its `aria-label`, which is the
  //    cleanest dashboard-side proof of "I'm logged in as the new account".
  await page.waitForURL((u) => !u.pathname.startsWith('/invite'), { timeout: 30_000 });
  await expect(
    page.getByRole('button', { name: new RegExp(`account menu for ${inviteeName}`, 'i') }),
  ).toBeVisible({ timeout: 15_000 });

  // 7. As a viewer, the invitee must NOT see the team-management link in the
  //    sidebar (`/settings/users` is admin-only).
  await expect(page.getByRole('link', { name: /^team$/i })).toHaveCount(0);
});
