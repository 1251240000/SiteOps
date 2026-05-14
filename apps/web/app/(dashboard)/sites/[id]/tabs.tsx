'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'traffic', label: 'Traffic' },
  { key: 'revenue', label: 'Revenue' },
  { key: 'uptime', label: 'Uptime' },
  { key: 'audits', label: 'Audits' },
  { key: 'deployments', label: 'Deployments' },
  { key: 'settings', label: 'Settings' },
] as const;

function tabHref(siteId: string, key: (typeof TABS)[number]['key']): string {
  if (key === 'overview') return `/sites/${siteId}`;
  return `/sites/${siteId}/${key}`;
}

function activeKey(pathname: string, siteId: string): string {
  if (pathname === `/sites/${siteId}` || pathname === `/sites/${siteId}/`) return 'overview';
  for (const t of TABS) {
    if (pathname.startsWith(`/sites/${siteId}/${t.key}`)) return t.key;
  }
  return 'overview';
}

export function SiteTabs({ siteId }: { siteId: string }) {
  const pathname = usePathname();
  const current = activeKey(pathname, siteId);

  return (
    <nav aria-label="Site sections" className="border-b border-border">
      <ul role="tablist" className="-mb-px flex flex-wrap gap-1">
        {TABS.map((t) => {
          const active = t.key === current;
          return (
            <li key={t.key}>
              <Link
                href={tabHref(siteId, t.key)}
                role="tab"
                aria-selected={active}
                className={cn(
                  'inline-flex h-9 items-center border-b-2 px-3 text-sm font-medium transition-colors',
                  active
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
