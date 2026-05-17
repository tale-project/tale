import { describe, expect, it } from 'vitest';

import type { BuildContext } from '../runtime/plugin';
import type { ResolvedRoutes } from '../types';
import { sitemapPlugin, SITEMAP_PATH } from './sitemap';

function makeCtx(routes: ResolvedRoutes): BuildContext {
  return {
    siteUrl: 'https://tale.dev',
    siteTitle: 'Tale',
    siteDescription: 'Sovereign AI.',
    routes: async () => routes,
    body: async () => null,
  };
}

describe('sitemapPlugin', () => {
  it('matches /sitemap.xml only', () => {
    expect(sitemapPlugin.match).toBe(SITEMAP_PATH);
  });

  it('returns null when no routes are declared', async () => {
    const ctx = makeCtx({ sections: [] });
    expect(await sitemapPlugin.build(SITEMAP_PATH, ctx)).toBeNull();
    expect(await sitemapPlugin.enumerate(ctx)).toEqual([]);
  });

  it('emits every route, including hideFromIndex sections', async () => {
    const ctx = makeCtx({
      sections: [
        {
          heading: 'Pages',
          routes: [
            { url: '/', title: 'Home' },
            { url: '/pricing', title: 'Pricing' },
          ],
        },
        {
          heading: 'Locales',
          hideFromIndex: true,
          routes: [{ url: '/de', title: 'Startseite' }],
        },
      ],
    });
    const result = await sitemapPlugin.build(SITEMAP_PATH, ctx);
    expect(result?.contentType).toBe('application/xml; charset=utf-8');
    expect(result?.body).toContain('<loc>https://tale.dev/</loc>');
    expect(result?.body).toContain('<loc>https://tale.dev/pricing</loc>');
    expect(result?.body).toContain('<loc>https://tale.dev/de</loc>');
  });

  it('emits xhtml:link entries for hreflang alternates', async () => {
    const ctx = makeCtx({
      sections: [
        {
          heading: 'Pages',
          routes: [
            {
              url: '/legal/privacy',
              title: 'Privacy',
              alternates: {
                en: 'https://tale.dev/legal/privacy',
                de: 'https://tale.dev/de/legal/privacy',
                'x-default': 'https://tale.dev/legal/privacy',
              },
            },
          ],
        },
      ],
    });
    const result = await sitemapPlugin.build(SITEMAP_PATH, ctx);
    expect(result?.body).toContain('hreflang="en"');
    expect(result?.body).toContain('hreflang="de"');
    expect(result?.body).toContain('hreflang="x-default"');
  });
});
