import { readLocaleCookie } from '@tale/ui/i18n/cookie';
import { negotiatePathLocale } from '@tale/ui/i18n/negotiate';
import { describe, expect, it } from 'vitest';

import { createRedirectRoute } from '@/lib/redirect-route';
import { buildRedirectPathMap } from '@/lib/redirects';

/**
 * The docs server's 301 route: it keeps the mount prefix and query, and an
 * `/en` page alias pins the English cookie so the follow-up request is not
 * negotiated onto the German or French page.
 */
describe('redirect route', () => {
  const route = createRedirectRoute({
    paths: buildRedirectPathMap({ 'old/page': 'new/page' }),
    basePath: '/docs',
    localeCookieDomain: '.example.test',
  });

  const call = (path: string, init?: RequestInit) => {
    const url = new URL(path, 'https://docs.example.test');
    return route(new Request(url, init), url);
  };

  it('answers a moved page with a 301 under the mount prefix, without a cookie', () => {
    const response = call('/de/old/page?q=1');
    expect(response?.status).toBe(301);
    expect(response?.headers.get('location')).toBe('/docs/de/new/page?q=1');
    expect(response?.headers.get('set-cookie')).toBeNull();
  });

  it('keeps a German-preferring reader on the English page after /en', () => {
    const response = call('/en/old/page', {
      headers: {
        'accept-language': 'de-CH,de;q=0.9',
        cookie: 'tale_locale=de',
      },
    });
    expect(response?.status).toBe(301);
    expect(response?.headers.get('location')).toBe('/docs/new/page');
    const setCookie = response?.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/^tale_locale=en;/);
    expect(setCookie).toContain('Domain=.example.test');
    expect(setCookie).toContain('Secure');
    expect(response?.headers.get('cache-control')).toBe('no-cache');

    // The browser's next request carries the pinned cookie: negotiation
    // serves the English page instead of redirecting to `/de/new/page`.
    const next = negotiatePathLocale({
      pathname: '/new/page',
      cookieHeader: setCookie.split(';')[0],
      acceptLanguageHeader: 'de-CH,de;q=0.9',
    });
    expect(readLocaleCookie(setCookie.split(';')[0])).toBe('en');
    expect(next.redirectTo).toBeNull();
    expect(next.locale).toBe('en');

    // Without it, the same reader would land on the German page.
    const unpinned = negotiatePathLocale({
      pathname: '/new/page',
      cookieHeader: 'tale_locale=de',
      acceptLanguageHeader: 'de-CH,de;q=0.9',
    });
    expect(unpinned.redirectTo).toBe('/de/new/page');
  });

  it('does not set a cookie for an /en alias of a locale-neutral file', () => {
    const response = call('/en/llms.txt');
    expect(response?.headers.get('location')).toBe('/docs/llms.txt');
    expect(response?.headers.get('set-cookie')).toBeNull();
  });

  it('leaves other methods and unmapped paths to the server', () => {
    expect(call('/en/old/page', { method: 'POST' })).toBeNull();
    expect(call('/new/page')).toBeNull();
  });
});
