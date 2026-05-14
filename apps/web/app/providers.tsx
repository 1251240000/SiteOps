'use client';

import { ThemeProvider } from 'next-themes';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { type ReactNode } from 'react';

import { TooltipProvider } from '@/components/ui/tooltip';
import { QueryProvider } from '@/lib/query-client';

/**
 * Composes every React-side provider the app needs.
 *
 *   ThemeProvider  → drives `data-theme` on <html> via next-themes
 *   QueryProvider  → TanStack Query (browser cache)
 *   NuqsAdapter    → URL <-> state sync for list filters / pagination
 *   TooltipProvider→ shared Radix tooltip portal (avoids re-mount cost)
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider
      attribute="data-theme"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <QueryProvider>
        <NuqsAdapter>
          <TooltipProvider delayDuration={150}>{children}</TooltipProvider>
        </NuqsAdapter>
      </QueryProvider>
    </ThemeProvider>
  );
}
