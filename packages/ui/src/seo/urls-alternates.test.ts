import { describe, expect, it } from 'vitest';

import {
  buildLocaleAlternateUrls,
  resolveHreflangFromAlternates,
  withXDefault,
} from './alternates';
import { TALE_DOCS_URL, TALE_SITE_URL } from './globals';
import { absoluteSitePath, docsOriginForSite } from './urls';

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

describe('docsOriginForSite', () => {
  it('prefixes the site host with `docs.`', () => {
    expect(docsOriginForSite('https://tale.dev')).toBe('https://docs.tale.dev');
    expect(docsOriginForSite('https://tale.dev/')).toBe(
      'https://docs.tale.dev',
    );
  });

  it('drops a leading `www.` instead of nesting under it', () => {
    expect(docsOriginForSite('https://www.example.com')).toBe(
      'https://docs.example.com',
    );
  });

  it('preserves scheme and port', () => {
    expect(docsOriginForSite('https://localhost:3002')).toBe(
      'https://docs.localhost:3002',
    );
    expect(docsOriginForSite('http://example.test')).toBe(
      'http://docs.example.test',
    );
  });

  it('returns the input when it is not an absolute URL', () => {
    expect(docsOriginForSite('tale.dev')).toBe('tale.dev');
  });
});

describe('TALE_DOCS_URL', () => {
  // Regression: the docs site moved to its own host, but the SEO layer kept
  // deriving `${TALE_SITE_URL}/docs`. Every canonical, hreflang and sitemap
  // entry then pointed at a URL that 308-redirects to the subdomain.
  it('is the docs subdomain, not a subpath of the marketing origin', () => {
    expect(TALE_DOCS_URL).toBe('https://docs.tale.dev');
    expect(TALE_DOCS_URL.startsWith(`${TALE_SITE_URL}/`)).toBe(false);
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
