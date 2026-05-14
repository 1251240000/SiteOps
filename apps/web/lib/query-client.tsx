'use client';

import { QueryClient, QueryClientProvider, isServer } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';

/**
 * Client-side TanStack Query setup.
 *
 * On the server we mint a fresh client per request to avoid leaking state
 * between visitors; in the browser we cache it on a module-level singleton
 * so React 19's StrictMode double-effect doesn't tear down active queries.
 */

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failureCount, error) => {
          // Don't bother retrying explicit auth / validation failures.
          const status = (error as { status?: number } | undefined)?.status;
          if (status && status >= 400 && status < 500) return false;
          return failureCount < 2;
        },
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

let browserClient: QueryClient | undefined;

function getQueryClient(): QueryClient {
  if (isServer) return makeQueryClient();
  if (!browserClient) browserClient = makeQueryClient();
  return browserClient;
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(getQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
