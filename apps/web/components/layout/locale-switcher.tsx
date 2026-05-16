'use client';

import { Globe } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SUPPORTED_LOCALES, type Locale } from '@/lib/i18n/locales';

/**
 * Topbar globe icon → dropdown of supported locales. Selection POSTs to the
 * cookie API which sets `Set-Cookie: siteops_locale=...`, then the page is
 * `router.refresh()`-ed so RSC re-renders with the new catalog. We do *not*
 * full-page reload — preserves form state, scroll, etc.
 */
export function LocaleSwitcher() {
  const t = useTranslations('topbar');
  const active = useLocale() as Locale;
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function setLocale(next: Locale) {
    if (next === active) return;
    startTransition(async () => {
      try {
        await fetch('/api/v1/me/preferences/locale', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ locale: next }),
        });
      } catch {
        // Network error: fall back to setting the cookie client-side so
        // the next request still picks the user's choice. Path/SameSite
        // mirror the API route.
        document.cookie = `siteops_locale=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
      }
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('localeAriaLabel', { active: localeLabel(active, t) })}
          disabled={pending}
        >
          <Globe className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        {SUPPORTED_LOCALES.map((loc) => (
          <DropdownMenuItem
            key={loc}
            onSelect={() => setLocale(loc)}
            data-active={loc === active}
            className="data-[active=true]:font-semibold"
          >
            {localeLabel(loc, t)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function localeLabel(loc: Locale, t: ReturnType<typeof useTranslations<'topbar'>>): string {
  if (loc === 'zh-CN') return t('localeChinese');
  if (loc === 'en-US') return t('localeEnglish');
  return loc;
}
