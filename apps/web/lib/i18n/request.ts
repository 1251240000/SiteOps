/**
 * next-intl request config. Loaded by `next-intl/plugin` (see
 * `next.config.mjs`) and called on every server-rendered request to decide
 * which locale + messages to inject into the React tree.
 *
 * The locale resolution itself lives in `pick-locale.ts` so we can unit-test
 * it without spinning up a request context.
 */
import { cookies, headers } from 'next/headers';
import type { AbstractIntlMessages } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';

import { DEFAULT_LOCALE, LOCALE_COOKIE, type Locale } from './locales';
import { pickLocale } from './pick-locale';

type MessageLoader = () => Promise<{ default: AbstractIntlMessages }>;

// Statically reference each catalog so Webpack can tree-shake / cache them.
// Dynamic `await import(\`./.../${locale}.json\`)` would also work but the
// explicit map gives a clearer build error if a locale file is missing.
const messagesByLocale: Record<Locale, MessageLoader> = {
  'zh-CN': () => import('../../messages/zh-CN.json') as Promise<{ default: AbstractIntlMessages }>,
  'en-US': () => import('../../messages/en-US.json') as Promise<{ default: AbstractIntlMessages }>,
};

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const headerStore = await headers();

  const locale = pickLocale({
    cookie: cookieStore.get(LOCALE_COOKIE)?.value,
    acceptLanguage: headerStore.get('accept-language'),
  });

  const loader = messagesByLocale[locale] ?? messagesByLocale[DEFAULT_LOCALE];
  const mod = await loader();

  return {
    locale,
    messages: mod.default,
  };
});
