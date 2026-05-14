import { type ReactNode } from 'react';

import { Sidebar } from './sidebar';
import { Topbar } from './topbar';

/**
 * Full dashboard chrome: persistent left sidebar (desktop), sticky topbar,
 * and the scrollable main area where every `(dashboard)` route renders.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen w-full bg-background text-foreground">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="flex-1 px-4 py-6 lg:px-8" tabIndex={-1} id="main">
          <div className="mx-auto w-full max-w-6xl space-y-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
