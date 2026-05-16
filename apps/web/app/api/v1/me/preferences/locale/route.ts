import { z } from 'zod';

import { AppError } from '@siteops/shared';

import { LOCALE_COOKIE, SUPPORTED_LOCALES } from '@/lib/i18n/locales';
import { ok, withApi } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

const setLocaleSchema = z.object({
  locale: z.enum(SUPPORTED_LOCALES),
});

/**
 * POST /api/v1/me/preferences/locale
 *
 * Persists the dashboard UI locale by setting the `siteops_locale` cookie.
 * Session-only (admin) — locale is a dashboard-side preference; API keys
 * have no business switching it.
 *
 * Note: Auth.js / unauthenticated users on `/login` switch via a pure
 * client-side `document.cookie` write in `LocaleSwitcher` — no API call —
 * so this endpoint deliberately requires a session.
 */
export const POST = withApi(async (req, _ctx) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new AppError('Invalid JSON body', { code: 'validation_failed', status: 400 });
  }

  const parsed = setLocaleSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError('Invalid locale', {
      code: 'validation_failed',
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  const res = ok({ locale: parsed.data.locale });
  res.cookies.set(LOCALE_COOKIE, parsed.data.locale, {
    path: '/',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
});
