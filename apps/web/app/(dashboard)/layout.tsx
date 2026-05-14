import { type ReactNode } from 'react';

import { AppShell } from '@/components/layout/app-shell';

/** Dashboard chrome shared by every authenticated route. */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
