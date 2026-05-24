'use client';

import { Menu, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

// Narrow subpath import — see `sidebar.tsx` for the rationale.
import { can, type UserRole } from '@siteops/shared/constants';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { NAV_ITEMS } from './nav-config';

export interface MobileNavProps {
  /** Role of the current session. Controls which nav entries are rendered. */
  role: UserRole;
}

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Mobile hamburger + slide-in drawer. Hidden at `lg` (the desktop Sidebar
 * takes over). Keeps focus-trapping simple — we just close on outside click
 * and ESC; a full Radix Dialog wrapper is overkill for an internal admin
 * tool.
 */
export function MobileNav({ role }: MobileNavProps) {
  const pathname = usePathname();
  const tNav = useTranslations('nav');
  const tSide = useTranslations('sidebar');
  const [open, setOpen] = useState(false);
  const visibleItems = NAV_ITEMS.filter((item) => !item.permission || can(role, item.permission));

  // Close on route change so navigating to a section dismisses the drawer.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // ESC to close, plus body scroll lock while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={() => setOpen(true)}
        aria-label={tSide('openMobileNav')}
        aria-expanded={open}
        aria-controls="mobile-nav-panel"
      >
        <Menu className="size-5" />
      </Button>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          {/* Backdrop */}
          <button
            type="button"
            aria-label={tSide('closeMobileNav')}
            className="absolute inset-0 bg-foreground/40"
            onClick={() => setOpen(false)}
          />
          {/* Panel */}
          <div
            id="mobile-nav-panel"
            className="absolute inset-y-0 left-0 flex w-64 max-w-[85%] flex-col border-r border-border bg-card shadow-xl"
          >
            <div className="flex h-14 items-center justify-between border-b border-border px-4">
              <Link href="/" className="flex items-center gap-2 font-semibold">
                <span
                  aria-hidden
                  className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground"
                >
                  S
                </span>
                siteops
              </Link>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setOpen(false)}
                aria-label={tSide('closeMobileNav')}
              >
                <X className="size-5" />
              </Button>
            </div>
            <nav className="flex flex-1 flex-col gap-1 p-2" aria-label={tNav('sectionsAriaLabel')}>
              {visibleItems.map((item) => {
                const active = isActive(pathname, item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                      active
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                    )}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden />
                    {tNav(item.key)}
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
      ) : null}
    </>
  );
}
