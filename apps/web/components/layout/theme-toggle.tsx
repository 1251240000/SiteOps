'use client';

import { Laptop, Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * Tri-state theme switcher (light / dark / system) persisted by next-themes.
 *
 * Guarded against hydration mismatch — until the client knows which theme
 * is active, we render the trigger with a neutral icon and an unset
 * `aria-label`. This is the recommended next-themes pattern.
 */
export function ThemeToggle() {
  const t = useTranslations('topbar');
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const active = (mounted && theme) || 'system';
  const Icon = mounted ? (resolvedTheme === 'dark' ? Moon : Sun) : Sun;
  const activeLabel =
    active === 'light' ? t('themeLight') : active === 'dark' ? t('themeDark') : t('themeSystem');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={
            mounted ? t('themeAriaLabel', { active: activeLabel }) : t('themeAriaLabelLoading')
          }
        >
          <Icon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        <DropdownMenuItem onSelect={() => setTheme('light')}>
          <Sun className="size-4" /> {t('themeLight')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme('dark')}>
          <Moon className="size-4" /> {t('themeDark')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme('system')}>
          <Laptop className="size-4" /> {t('themeSystem')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
