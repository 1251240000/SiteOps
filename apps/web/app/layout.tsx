import '@/styles/globals.css';

import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { type ReactNode } from 'react';

import { Toaster } from '@/components/ui/sonner';

import { AppProviders } from './providers';

export const metadata = {
  title: 'siteops',
  description: 'Internal multi-site operations dashboard',
};

/**
 * Root layout. Wraps every route — both `(auth)` and `(dashboard)` — in:
 *   - the next-intl client provider so client components can `useTranslations()`
 *   - the shared client providers (theme, query, nuqs, tooltip portal)
 *   - the global toast outlet
 *
 * Locale resolution lives in `lib/i18n/request.ts` (called by next-intl's
 * `getLocale` / `getMessages` here). Both helpers read the `siteops_locale`
 * cookie that the middleware seeds on first paint.
 *
 * `suppressHydrationWarning` on <html> is the canonical next-themes
 * recommendation; the theme attribute is set client-side and would
 * otherwise produce a hydration warning during the very first paint.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <AppProviders>
            {children}
            <Toaster richColors closeButton position="bottom-right" />
          </AppProviders>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
