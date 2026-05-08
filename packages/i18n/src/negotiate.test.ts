import { describe, expect, it } from 'vitest';

import { isLocaleNeutralPath, negotiatePathLocale } from './negotiate';

const NO_HEADERS = { cookieHeader: null, acceptLanguageHeader: null };

describe('isLocaleNeutralPath', () => {
  it('skips static SEO/agent endpoints', () => {
    expect(isLocaleNeutralPath('/sitemap.xml')).toBe(true);
    expect(isLocaleNeutralPath('/robots.txt')).toBe(true);
    expect(isLocaleNeutralPath('/llms.txt')).toBe(true);
    expect(isLocaleNeutralPath('/llms-full.txt')).toBe(true);
  });

  it('skips markdown exports and api routes', () => {
    expect(isLocaleNeutralPath('/docs/intro.md')).toBe(true);
    expect(isLocaleNeutralPath('/api/health')).toBe(true);
    expect(isLocaleNeutralPath('/api/forms/submit')).toBe(true);
  });

  it('does not skip locale-prefixed or normal pages', () => {
    expect(isLocaleNeutralPath('/')).toBe(false);
    expect(isLocaleNeutralPath('/de/pricing')).toBe(false);
    expect(isLocaleNeutralPath('/fr')).toBe(false);
    expect(isLocaleNeutralPath('/pricing')).toBe(false);
  });
});

describe('negotiatePathLocale — locale-neutral paths', () => {
  it('returns skip=true for sitemap/robots/llms/api/.md', () => {
    for (const pathname of [
      '/sitemap.xml',
      '/robots.txt',
      '/llms.txt',
      '/llms-full.txt',
      '/api/health',
      '/docs/intro.md',
    ]) {
      const result = negotiatePathLocale({ pathname, ...NO_HEADERS });
      expect(result).toEqual({
        locale: 'en',
        redirectTo: null,
        setCookieValue: null,
        skip: true,
      });
    }
  });
});

describe('negotiatePathLocale — locale-prefixed paths', () => {
  it('keeps a /de path and refreshes a missing cookie', () => {
    const result = negotiatePathLocale({ pathname: '/de', ...NO_HEADERS });
    expect(result).toEqual({
      locale: 'de',
      redirectTo: null,
      setCookieValue: 'de',
      skip: false,
    });
  });

  it('keeps a /fr/pricing path and does NOT rewrite a matching cookie', () => {
    const result = negotiatePathLocale({
      pathname: '/fr/pricing',
      cookieHeader: 'tale_locale=fr',
      acceptLanguageHeader: null,
    });
    expect(result).toEqual({
      locale: 'fr',
      redirectTo: null,
      setCookieValue: null,
      skip: false,
    });
  });

  it('keeps /de but rewrites the cookie when it disagrees', () => {
    const result = negotiatePathLocale({
      pathname: '/de/pricing',
      cookieHeader: 'tale_locale=fr',
      acceptLanguageHeader: null,
    });
    expect(result.locale).toBe('de');
    expect(result.redirectTo).toBeNull();
    expect(result.setCookieValue).toBe('de');
  });
});

describe('negotiatePathLocale — unprefixed paths with cookie', () => {
  it('redirects to /<cookie> when cookie is de', () => {
    const result = negotiatePathLocale({
      pathname: '/pricing',
      cookieHeader: 'tale_locale=de',
      acceptLanguageHeader: null,
    });
    expect(result).toEqual({
      locale: 'de',
      redirectTo: '/de/pricing',
      setCookieValue: null,
      skip: false,
    });
  });

  it('redirects to /<cookie> when cookie is fr at root', () => {
    const result = negotiatePathLocale({
      pathname: '/',
      cookieHeader: 'tale_locale=fr',
      acceptLanguageHeader: null,
    });
    expect(result.redirectTo).toBe('/fr');
  });

  it('stays on EN canonical path when cookie is en', () => {
    const result = negotiatePathLocale({
      pathname: '/pricing',
      cookieHeader: 'tale_locale=en',
      acceptLanguageHeader: 'de-DE,de;q=0.9',
    });
    expect(result).toEqual({
      locale: 'en',
      redirectTo: null,
      setCookieValue: null,
      skip: false,
    });
  });
});

describe('negotiatePathLocale — unprefixed paths without cookie', () => {
  it('redirects + sets cookie when Accept-Language is de', () => {
    const result = negotiatePathLocale({
      pathname: '/pricing',
      cookieHeader: null,
      acceptLanguageHeader: 'de-DE,de;q=0.9,en;q=0.5',
    });
    expect(result).toEqual({
      locale: 'de',
      redirectTo: '/de/pricing',
      setCookieValue: 'de',
      skip: false,
    });
  });

  it('redirects + sets cookie when Accept-Language is fr at root', () => {
    const result = negotiatePathLocale({
      pathname: '/',
      cookieHeader: null,
      acceptLanguageHeader: 'fr-CH,fr;q=0.9',
    });
    expect(result.redirectTo).toBe('/fr');
    expect(result.setCookieValue).toBe('fr');
  });

  it('stays on EN + sets cookie when Accept-Language prefers en', () => {
    const result = negotiatePathLocale({
      pathname: '/pricing',
      cookieHeader: null,
      acceptLanguageHeader: 'en-US,en;q=0.9,de;q=0.5',
    });
    expect(result).toEqual({
      locale: 'en',
      redirectTo: null,
      setCookieValue: 'en',
      skip: false,
    });
  });

  it('stays on EN + sets cookie when no candidate is supported (es-ES)', () => {
    const result = negotiatePathLocale({
      pathname: '/',
      cookieHeader: null,
      acceptLanguageHeader: 'es-ES,es;q=0.9',
    });
    expect(result).toEqual({
      locale: 'en',
      redirectTo: null,
      setCookieValue: 'en',
      skip: false,
    });
  });

  it('stays on EN + sets cookie when no Accept-Language header at all', () => {
    const result = negotiatePathLocale({
      pathname: '/',
      cookieHeader: null,
      acceptLanguageHeader: null,
    });
    expect(result.locale).toBe('en');
    expect(result.setCookieValue).toBe('en');
  });

  it('treats malformed cookie as missing (e.g. tale_locale=xx)', () => {
    const result = negotiatePathLocale({
      pathname: '/',
      cookieHeader: 'tale_locale=xx',
      acceptLanguageHeader: 'de;q=0.9',
    });
    expect(result.locale).toBe('de');
    expect(result.redirectTo).toBe('/de');
    expect(result.setCookieValue).toBe('de');
  });
});
