import { auth } from '@/lib/auth';

import { Breadcrumbs } from './breadcrumbs';
import { LocaleSwitcher } from './locale-switcher';
import { MobileNav } from './mobile-nav';
import { ThemeToggle } from './theme-toggle';
import { UserMenu } from './user-menu';

/**
 * Sticky page-top bar. Server component so the user identity is rendered
 * from the session on first paint — no client-side fetch round-trip.
 */
export async function Topbar() {
  const session = await auth();
  const user = session?.user;

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 lg:px-6">
      <MobileNav />
      <Breadcrumbs />
      <div className="ml-auto flex items-center gap-1">
        <LocaleSwitcher />
        <ThemeToggle />
        {user ? <UserMenu email={user.email ?? ''} name={user.name ?? null} /> : null}
      </div>
    </header>
  );
}
