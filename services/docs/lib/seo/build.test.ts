/**
 * Characterization tests for docs SEO route discovery — noindex pages must
 * stay out of sitemap.xml while remaining in robots.disallow and llms.txt.
 */

import { describe, expect, it } from 'vitest';

import { buildDocsCompileParams, buildDocsSeo, docsSiteUrl } from './build';

describe('docs SEO build', () => {
  it('excludes noindex routes from sitemap sections', async () => {
    const { sections, noindexPaths } = await buildDocsSeo(docsSiteUrl());

    expect(noindexPaths.length).toBeGreaterThan(0);
    expect(noindexPaths).toContain('/legal/privacy');
    expect(noindexPaths).toContain('/de/legal/privacy');

    const sitemapUrls = sections
      .filter((s) => !s.excludeFromSitemap)
      .flatMap((s) => s.routes.map((r) => r.url));
    for (const path of noindexPaths) {
      expect(sitemapUrls).not.toContain(path);
    }

    const legalSection = sections.find(
      (s) => s.heading === 'Legal' && s.excludeFromSitemap,
    );
    expect(legalSection).toBeDefined();
    expect(legalSection?.routes.some((r) => r.url === '/legal/privacy')).toBe(
      true,
    );
  });

  it('advertises the marketing sitemap from robots', async () => {
    const params = await buildDocsCompileParams();
    expect(params.robots?.extraSitemaps).toContain(
      'https://tale.dev/sitemap.xml',
    );
    expect(params.robots?.disallow).toContain('/legal/privacy');
  });
});
