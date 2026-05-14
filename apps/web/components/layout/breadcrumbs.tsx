'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo } from 'react';

import { NAV_ITEMS } from './nav-config';

type Crumb = { href: string; label: string };

const LABEL_BY_SEGMENT = new Map(
  NAV_ITEMS.filter((n) => n.href !== '/').map((n) => [n.href.slice(1), n.label]),
);

function humanize(segment: string): string {
  return segment
    .split('-')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

export function Breadcrumbs() {
  const pathname = usePathname();
  const crumbs = useMemo<Crumb[]>(() => {
    const out: Crumb[] = [{ href: '/', label: 'Overview' }];
    if (pathname === '/' || pathname === '') return out;
    const parts = pathname.split('/').filter(Boolean);
    let acc = '';
    for (const part of parts) {
      acc += `/${part}`;
      out.push({ href: acc, label: LABEL_BY_SEGMENT.get(part) ?? humanize(part) });
    }
    return out;
  }, [pathname]);

  if (crumbs.length <= 1) return null;

  return (
    <nav aria-label="Breadcrumb" className="hidden text-sm md:block">
      <ol className="flex items-center gap-1.5 text-muted-foreground">
        {crumbs.map((crumb, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={crumb.href} className="flex items-center gap-1.5">
              {i > 0 ? <ChevronRight className="size-3.5" aria-hidden /> : null}
              {last ? (
                <span className="font-medium text-foreground" aria-current="page">
                  {crumb.label}
                </span>
              ) : (
                <Link href={crumb.href} className="hover:text-foreground">
                  {crumb.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
