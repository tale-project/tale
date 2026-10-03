/**
 * Characterization tests for docs SEO route discovery — noindex pages must
 * stay out of sitemap.xml while remaining in robots.disallow and llms.txt.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { buildDocsCompileParams, buildDocsSeo, docsSiteUrl } from './build';

describe('docsSiteUrl', () => {
  // Regression: this origin is stamped into every canonical, hreflang and
  // sitemap <loc> the docs build emits. While it was `https://tale.dev/docs`,
  // all 432 of those URLs 308-redirected to the docs subdomain.
  it('is the docs subdomain, with no trailing slash', () => {
    expect(docsSiteUrl()).toBe('https://docs.tale.dev');
    expect(docsSiteUrl()).not.toMatch(/\/$/);
  });

  it('uses the canonical docs host in the pre-hydration HTML shell', () => {
    const shell = readFileSync(
      new URL('../../index.html', import.meta.url),
      'utf8',
    );
    expect(shell).toContain('rel="canonical" href="https://docs.tale.dev/"');
    expect(shell).toContain(
      'property="og:url" content="https://docs.tale.dev/"',
    );
    expect(shell).not.toContain('https://tale.dev/docs');
  });
});

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
