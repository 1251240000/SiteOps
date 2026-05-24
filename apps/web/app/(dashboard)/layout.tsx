import { type ReactNode } from 'react';

import type { UserRole } from '@siteops/shared';

import { AppShell } from '@/components/layout/app-shell';
import { auth } from '@/lib/auth';

/**
 * Dashboard chrome shared by every authenticated route.
 *
 * Resolves the session role here (server-side) so the sidebar and mobile
 * nav can RBAC-filter their entries on the first paint with zero client
 * round-trip. The middleware has already gated `/(dashboard)` behind a
 * valid session, so falling back to `'viewer'` is a defensive choice —
 * we never let a missing role accidentally widen access.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  const role: UserRole = (session?.user as { role?: UserRole } | undefined)?.role ?? 'viewer';
  return <AppShell role={role}>{children}</AppShell>;
}
