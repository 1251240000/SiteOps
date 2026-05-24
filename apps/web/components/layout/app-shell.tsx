import { type ReactNode } from 'react';

import type { UserRole } from '@siteops/shared';

import { Sidebar } from './sidebar';
import { Topbar } from './topbar';

export interface AppShellProps {
  children: ReactNode;
  /**
   * Role of the active session. Threaded into Sidebar / Topbar (mobile-nav)
   * so they can hide nav entries the role does not have access to (T40).
   */
  role: UserRole;
}

/**
 * Full dashboard chrome: persistent left sidebar (desktop), sticky topbar,
 * and the scrollable main area where every `(dashboard)` route renders.
 */
export function AppShell({ children, role }: AppShellProps) {
  return (
    <div className="flex min-h-screen w-full bg-background text-foreground">
      <Sidebar role={role} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar role={role} />
        <main className="flex-1 px-4 py-6 lg:px-8" tabIndex={-1} id="main">
          <div className="mx-auto w-full max-w-6xl space-y-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
