import { describe, expect, it } from 'vitest';

import {
  buildLocaleAlternateUrls,
  resolveHreflangFromAlternates,
  withXDefault,
} from './alternates';
import { absoluteSitePath } from './urls';

describe('absoluteSitePath', () => {
  it('joins origin and path without double slashes', () => {
    expect(absoluteSitePath('https://tale.dev/', '/pricing')).toBe(
      'https://tale.dev/pricing',
    );
    expect(absoluteSitePath('https://tale.dev', '/')).toBe('https://tale.dev/');
    expect(absoluteSitePath('https://tale.dev/docs/', '/de/foo')).toBe(
      'https://tale.dev/docs/de/foo',
    );
  });
});

describe('buildLocaleAlternateUrls + withXDefault', () => {
  it('builds absolute URLs and attaches x-default', () => {
    const alts = buildLocaleAlternateUrls(
      'https://tale.dev',
      ['en', 'de', 'fr'],
      (locale) => (locale === 'en' ? '/pricing' : `/${locale}/pricing`),
    );
    expect(alts).toEqual({
      en: 'https://tale.dev/pricing',
      de: 'https://tale.dev/de/pricing',
      fr: 'https://tale.dev/fr/pricing',
    });
    expect(withXDefault(alts)['x-default']).toBe('https://tale.dev/pricing');
  });

  it('skips locales whose path is null', () => {
    const alts = buildLocaleAlternateUrls(
      'https://tale.dev/docs',
      ['en', 'de', 'fr'],
      (locale) =>
        locale === 'fr' ? null : locale === 'en' ? '/' : `/${locale}`,
    );
    expect(alts).toEqual({
      en: 'https://tale.dev/docs/',
      de: 'https://tale.dev/docs/de',
    });
  });
});

describe('resolveHreflangFromAlternates', () => {
  it('returns empty when noindex or missing alternates', () => {
    expect(
      resolveHreflangFromAlternates('en', { en: 'https://tale.dev/' }, true),
    ).toEqual({});
    expect(resolveHreflangFromAlternates('en', undefined)).toEqual({});
    expect(resolveHreflangFromAlternates('en', {})).toEqual({});
  });

  it('returns hreflang + alternateLocales for a full map', () => {
    const alternates = {
      en: 'https://tale.dev/docs/',
      de: 'https://tale.dev/docs/de',
    };
    expect(resolveHreflangFromAlternates('de', alternates)).toEqual({
      hreflang: { locale: 'de', alternates },
      alternateLocales: ['en', 'de'],
    });
  });
});
