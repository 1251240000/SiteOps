import { describe, expect, it } from 'vitest';

import { DEFAULT_LOCALE } from './locales';
import { pickLocale } from './pick-locale';

describe('pickLocale', () => {
  it('returns cookie value when it is a supported locale', () => {
    expect(pickLocale({ cookie: 'en-US', acceptLanguage: 'zh-CN' })).toBe('en-US');
    expect(pickLocale({ cookie: 'zh-CN', acceptLanguage: 'en-US' })).toBe('zh-CN');
  });

  it('ignores cookie when it is an unsupported locale', () => {
    // Falls through to header / default.
    expect(pickLocale({ cookie: 'fr-FR', acceptLanguage: 'en-US' })).toBe('en-US');
    expect(pickLocale({ cookie: 'garbage', acceptLanguage: null })).toBe(DEFAULT_LOCALE);
  });

  it('prefers the highest-quality acceptable header tag', () => {
    expect(pickLocale({ cookie: undefined, acceptLanguage: 'en-US,zh-CN;q=0.9' })).toBe('en-US');
    expect(pickLocale({ cookie: undefined, acceptLanguage: 'fr-FR;q=1,zh-CN;q=0.5' })).toBe(
      'zh-CN',
    );
  });

  it('normalizes case in header tags', () => {
    expect(pickLocale({ cookie: undefined, acceptLanguage: 'en-us' })).toBe('en-US');
    expect(pickLocale({ cookie: undefined, acceptLanguage: 'ZH-cn' })).toBe('zh-CN');
  });

  it('falls back to primary subtag match', () => {
    // `zh` alone is not in SUPPORTED_LOCALES but should resolve to zh-CN.
    expect(pickLocale({ cookie: undefined, acceptLanguage: 'zh' })).toBe('zh-CN');
    expect(pickLocale({ cookie: undefined, acceptLanguage: 'en' })).toBe('en-US');
  });

  it('falls back to DEFAULT_LOCALE on empty / unmatched input', () => {
    expect(pickLocale({ cookie: undefined, acceptLanguage: '' })).toBe(DEFAULT_LOCALE);
    expect(pickLocale({ cookie: undefined, acceptLanguage: null })).toBe(DEFAULT_LOCALE);
    expect(pickLocale({ cookie: undefined, acceptLanguage: 'fr-FR,de-DE;q=0.8' })).toBe(
      DEFAULT_LOCALE,
    );
  });

  it('drops zero-quality entries', () => {
    expect(pickLocale({ cookie: undefined, acceptLanguage: 'en-US;q=0,zh-CN;q=0.5' })).toBe(
      'zh-CN',
    );
  });
});
