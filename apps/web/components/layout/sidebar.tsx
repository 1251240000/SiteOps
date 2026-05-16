'use client';

import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { NAV_ITEMS } from './nav-config';

const STORAGE_KEY = 'siteops:sidebar-collapsed';

/** Active when the link target is the current path or a parent of it. */
function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar() {
  const pathname = usePathname();
  const tNav = useTranslations('nav');
  const tSide = useTranslations('sidebar');
  const [collapsed, setCollapsed] = useState<boolean>(false);

  // Read the persisted preference after mount — avoids hydration mismatches
  // that would otherwise flash the wrong width on the first paint.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === '1') setCollapsed(true);
    } catch {
      /* localStorage may be disabled; ignore. */
    }
  }, []);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  return (
    <aside
      aria-label={tSide('primaryAriaLabel')}
      className={cn(
        'sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-card transition-[width] duration-200 ease-out lg:flex',
        collapsed ? 'w-[68px]' : 'w-60',
      )}
    >
      <div
        className={cn(
          'flex h-14 items-center border-b border-border px-3',
          collapsed ? 'justify-center' : 'justify-between',
        )}
      >
        <Link
          href="/"
          className={cn(
            'flex items-center gap-2 font-semibold tracking-tight text-foreground',
            collapsed && 'sr-only',
          )}
        >
          <span
            aria-hidden
            className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground"
          >
            S
          </span>
          siteops
        </Link>
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? tSide('expand') : tSide('collapse')}
          aria-pressed={collapsed}
          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
        </button>
      </div>

      <nav className="flex flex-1 flex-col gap-1 p-2" aria-label={tNav('sectionsAriaLabel')}>
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          const label = tNav(item.key);
          const link = (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'group flex items-center gap-3 rounded-md px-2 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                collapsed && 'justify-center px-0',
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              <span className={cn(collapsed && 'sr-only')}>{label}</span>
            </Link>
          );

          // When collapsed, show the label via tooltip on hover/focus.
          return collapsed ? (
            <Tooltip key={item.href}>
              <TooltipTrigger asChild>{link}</TooltipTrigger>
              <TooltipContent side="right">{label}</TooltipContent>
            </Tooltip>
          ) : (
            link
          );
        })}
      </nav>

      <div className="border-t border-border p-3 text-xs text-muted-foreground">
        <span className={cn(collapsed && 'sr-only')}>
          {tSide('footer', { version: '0.0.0', year: new Date().getFullYear() })}
        </span>
      </div>
    </aside>
  );
}
