'use client';

import { LogOut, UserRound } from 'lucide-react';
import { signOut } from 'next-auth/react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface UserMenuProps {
  email: string;
  name: string | null;
}

function initials(name: string | null, email: string): string {
  const base = name && name.trim().length > 0 ? name : email;
  const parts = base.split(/[\s@.]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

export function UserMenu({ email, name }: UserMenuProps) {
  const t = useTranslations('topbar');
  const displayName = name ?? t('accountDefaultName');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('accountAriaLabel', { name: name ?? email })}
          className="size-9 rounded-full"
        >
          <span
            aria-hidden
            className="grid size-7 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
          >
            {initials(name, email)}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex items-center gap-2">
          <UserRound className="size-4" />
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{displayName}</span>
            <span className="truncate text-xs font-normal text-muted-foreground">{email}</span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            void signOut({ callbackUrl: '/login' });
          }}
        >
          <LogOut className="size-4" /> {t('signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
