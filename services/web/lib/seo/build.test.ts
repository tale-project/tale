import { describe, expect, it } from 'vitest';

import {
  WEB_LLMS_PAGES_INTRO,
  buildWebSections,
  legalDisallowPaths,
} from './build';

describe('llms.txt product facts', () => {
  it('exposes a factual Pages intro for AIO/LLMO crawlers', () => {
    expect(WEB_LLMS_PAGES_INTRO).toMatch(/Ruler GmbH/);
    expect(WEB_LLMS_PAGES_INTRO).toMatch(/MIT/);
    expect(WEB_LLMS_PAGES_INTRO).toMatch(/ISO 27001/);
    expect(WEB_LLMS_PAGES_INTRO).toMatch(/Claude Code/);
    expect(WEB_LLMS_PAGES_INTRO).toMatch(/CHF 12/);
  });

  it('attaches the intro to the Pages section', () => {
    const sections = buildWebSections([]);
    const pages = sections.find((s) => s.heading === 'Pages');
    expect(pages?.intro).toBe(WEB_LLMS_PAGES_INTRO);
  });
});

describe('legal SEO contract', () => {
  it('excludes legal routes from sitemap sections', () => {
    const legal = [
      {
        locale: 'en' as const,
        slug: 'privacy-policy',
        url: '/legal/privacy-policy',
        title: 'Privacy',
        description: 'Privacy',
      },
      {
        locale: 'de' as const,
        slug: 'privacy-policy',
        url: '/de/legal/privacy-policy',
        title: 'Datenschutz',
        description: 'Datenschutz',
      },
    ];
    const sections = buildWebSections(legal);
    const sitemapUrls = sections
      .filter((s) => !s.excludeFromSitemap)
      .flatMap((s) => s.routes.map((r) => r.url));
    expect(sitemapUrls).not.toContain('/legal/privacy-policy');
    expect(sitemapUrls).not.toContain('/de/legal/privacy-policy');
    expect(legalDisallowPaths(legal)).toEqual([
      '/legal/privacy-policy',
      '/de/legal/privacy-policy',
    ]);
  });
});
