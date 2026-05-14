import '@/styles/globals.css';

import { type ReactNode } from 'react';

import { Toaster } from '@/components/ui/sonner';

import { AppProviders } from './providers';

export const metadata = {
  title: 'siteops',
  description: 'Internal multi-site operations dashboard',
};

/**
 * Root layout. Wraps every route — both `(auth)` and `(dashboard)` — in the
 * shared client providers (theme, query, nuqs, tooltip portal) and mounts
 * the global toast outlet.
 *
 * `suppressHydrationWarning` on <html> is the canonical next-themes
 * recommendation; the theme attribute is set client-side and would
 * otherwise produce a hydration warning during the very first paint.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <AppProviders>
          {children}
          <Toaster richColors closeButton position="bottom-right" />
        </AppProviders>
      </body>
    </html>
  );
}
