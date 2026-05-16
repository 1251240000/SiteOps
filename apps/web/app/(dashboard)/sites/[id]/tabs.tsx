'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

type TabKey = 'overview' | 'traffic' | 'revenue' | 'uptime' | 'audits' | 'deployments' | 'settings';

/** i18n key under `pages.sites.detail.tab<Pascal>`. */
const TAB_KEYS: readonly TabKey[] = [
  'overview',
  'traffic',
  'revenue',
  'uptime',
  'audits',
  'deployments',
  'settings',
];

const TAB_LABEL_KEY: Record<TabKey, string> = {
  overview: 'tabOverview',
  traffic: 'tabTraffic',
  revenue: 'tabRevenue',
  uptime: 'tabUptime',
  audits: 'tabAudits',
  deployments: 'tabDeployments',
  settings: 'tabSettings',
};

function tabHref(siteId: string, key: TabKey): string {
  if (key === 'overview') return `/sites/${siteId}`;
  return `/sites/${siteId}/${key}`;
}

function activeKey(pathname: string, siteId: string): TabKey {
  if (pathname === `/sites/${siteId}` || pathname === `/sites/${siteId}/`) return 'overview';
  for (const k of TAB_KEYS) {
    if (pathname.startsWith(`/sites/${siteId}/${k}`)) return k;
  }
  return 'overview';
}

export function SiteTabs({ siteId }: { siteId: string }) {
  const pathname = usePathname();
  const t = useTranslations('pages.sites.detail');
  const current = activeKey(pathname, siteId);

  return (
    <nav aria-label={t('tabsAriaLabel')} className="border-b border-border">
      <ul role="tablist" className="-mb-px flex flex-wrap gap-1">
        {TAB_KEYS.map((key) => {
          const active = key === current;
          return (
            <li key={key}>
              <Link
                href={tabHref(siteId, key)}
                role="tab"
                aria-selected={active}
                className={cn(
                  'inline-flex h-9 items-center border-b-2 px-3 text-sm font-medium transition-colors',
                  active
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {t(TAB_LABEL_KEY[key])}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
