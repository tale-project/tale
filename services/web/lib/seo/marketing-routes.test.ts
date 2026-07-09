import { describe, expect, it } from 'vitest';

import { PLATFORM_PAGES } from '@/app/content/platform-pages';

import { MARKETING_ROUTE_URLS } from './marketing-routes';
import { LOCALIZED_ROUTE_PATHS, ROUTE_PATHS } from './route-paths';

/**
 * A marketing page must be registered in both tables or it is half-wired:
 * ROUTE_PATHS drives LocalizedLink; ROUTE_SEO_KEYS drives prerender/sitemap.
 */
describe('marketing route registries', () => {
  it('keeps ROUTE_SEO_KEYS and ROUTE_PATHS in bijection', () => {
    const seo = new Set(MARKETING_ROUTE_URLS);
    const paths = new Set(LOCALIZED_ROUTE_PATHS);

    const missingFromPaths = [...seo].filter((url) => !paths.has(url as never));
    const missingFromSeo = [...paths].filter((url) => !seo.has(url));

    expect(missingFromPaths).toEqual([]);
    expect(missingFromSeo).toEqual([]);
  });

  it('keeps PLATFORM_PAGES paths inside ROUTE_PATHS', () => {
    const known = new Set(Object.keys(ROUTE_PATHS));
    for (const page of PLATFORM_PAGES) {
      expect(known.has(page.path), `${page.id} path ${page.path}`).toBe(true);
    }
  });
});
