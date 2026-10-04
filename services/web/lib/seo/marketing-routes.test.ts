import { describe, expect, it } from 'vitest';

import { PLATFORM_PAGES } from '@/app/content/platform-pages';
import { MARKETING_CONTENT_PATHS } from '@/lib/content/model';
import { publishedMarketingContent } from '@/lib/content/server';

import { MARKETING_ROUTE_URLS } from './marketing-routes';
import { LOCALIZED_ROUTE_PATHS, ROUTE_PATHS } from './route-paths';

/**
 * A marketing page must be registered in both tables or it is half-wired:
 * ROUTE_PATHS drives LocalizedLink; ROUTE_SEO_KEYS drives prerender/sitemap.
 */
describe('marketing route registries', () => {
  it('keeps static route keys and paths in bijection', () => {
    const contentPaths = new Set(
      publishedMarketingContent().map((page) => page.path),
    );
    const hubs: ReadonlySet<string> = new Set(
      Object.values(MARKETING_CONTENT_PATHS),
    );
    const seo = new Set(
      MARKETING_ROUTE_URLS.filter((url) => !contentPaths.has(url)),
    );
    const paths = new Set(
      LOCALIZED_ROUTE_PATHS.filter((url) => !hubs.has(url)),
    );

    const missingFromPaths = [...seo].filter((url) => !paths.has(url as never));
    const missingFromSeo = [...paths].filter((url) => !seo.has(url));

    expect(missingFromPaths).toEqual([]);
    expect(missingFromSeo).toEqual([]);
  });

  it('discovers every published English content page from the shared model', () => {
    const expected = publishedMarketingContent()
      .filter((page) => page.locale === 'en')
      .map((page) => page.url);
    const actual = MARKETING_ROUTE_URLS.filter(
      (url) =>
        url === '/compare' ||
        url.startsWith('/compare/') ||
        url === '/use-cases' ||
        url.startsWith('/use-cases/'),
    );
    expect(actual).toEqual(expected);
  });

  it('keeps PLATFORM_PAGES paths inside ROUTE_PATHS', () => {
    const known = new Set(Object.keys(ROUTE_PATHS));
    for (const page of PLATFORM_PAGES) {
      expect(known.has(page.path), `${page.id} path ${page.path}`).toBe(true);
    }
  });
});
