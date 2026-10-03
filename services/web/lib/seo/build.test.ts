import { TALE_DOCS_LLMS_TXT } from '@tale/ui/seo/globals';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as contentRegistry from '../content/server';
import { localizedPath, SUPPORTED_LOCALES } from '../i18n/locales';
import { createMarketingArtifactsServer } from './artifacts-server';
import {
  WEB_LLMS_PAGES_INTRO,
  buildWebSections,
  webOptionalPages,
  makeWebLoadBody,
} from './build';

afterEach(() => vi.restoreAllMocks());

describe('localized marketing content discovery', () => {
  it('serializes shared-i18n SSR across locales and continues after a failed render', async () => {
    let currentUrl = '';
    const render = vi.fn(async (url: string) => {
      currentUrl = url;
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (url === '/contact') throw new Error('fixture render failed');
      return { html: `<main><p>${currentUrl}</p></main>` };
    });
    const load = makeWebLoadBody({ render });
    const results = await Promise.allSettled(
      ['/', '/de', '/contact', '/fr'].map(async (url) =>
        (await load(url))?.trim(),
      ),
    );
    expect(results).toEqual([
      { status: 'fulfilled', value: '/' },
      { status: 'fulfilled', value: '/de' },
      { status: 'rejected', reason: new Error('fixture render failed') },
      { status: 'fulfilled', value: '/fr' },
    ]);
  });

  it('uses each published translation metadata with one complete alternate cluster', () => {
    const pages = contentRegistry
      .readMarketingContent()
      .filter((page) => page.slug === 'tale-vs-multica');
    for (const page of pages) page.frontmatter.draft = false;
    vi.spyOn(contentRegistry, 'publishedMarketingContent').mockReturnValue(
      pages,
    );
    const sections = buildWebSections([]);
    for (const page of pages) {
      const route = sections
        .flatMap((section) => section.routes)
        .find((entry) => entry.url === page.url);
      expect(route?.title).toBe(page.frontmatter.title);
      expect(route?.description).toBe(page.frontmatter.description);
      expect(route?.alternates).toEqual({
        en: 'https://tale.dev/compare/tale-vs-multica',
        de: 'https://tale.dev/de/compare/tale-vs-multica',
        fr: 'https://tale.dev/fr/compare/tale-vs-multica',
        'x-default': 'https://tale.dev/compare/tale-vs-multica',
      });
    }
    const llmsUrls = sections
      .filter((section) => !section.hideFromIndex)
      .flatMap((section) => section.routes.map((route) => route.url));
    expect(llmsUrls).toContain('/compare/tale-vs-multica');
    expect(llmsUrls).not.toContain('/de/compare/tale-vs-multica');
  });

  it('never serves a draft body through SEO artifact discovery', async () => {
    vi.spyOn(contentRegistry, 'publishedMarketingContent').mockReturnValue([]);
    const render = vi.fn();
    expect(
      await makeWebLoadBody({ render })('/compare/tale-vs-multica'),
    ).toBeNull();
    expect(render).not.toHaveBeenCalled();
    expect(
      buildWebSections([])
        .flatMap((section) => section.routes)
        .some((route) => route.url.startsWith('/compare')),
    ).toBe(false);
  });
});

describe('llms.txt product facts', () => {
  it('exposes a factual Pages intro for AIO/LLMO crawlers', () => {
    expect(WEB_LLMS_PAGES_INTRO).toMatch(/Ruler GmbH/);
    expect(WEB_LLMS_PAGES_INTRO).toMatch(/MIT/);
    expect(WEB_LLMS_PAGES_INTRO).toMatch(/Claude Code/);
    expect(WEB_LLMS_PAGES_INTRO).toMatch(/https:\/\/tale\.dev\/pricing/);
  });

  it('points readers directly to the canonical documentation index', () => {
    expect(WEB_LLMS_PAGES_INTRO).toContain(TALE_DOCS_LLMS_TXT);
    expect(WEB_LLMS_PAGES_INTRO).not.toContain('https://tale.dev/docs');
  });

  it('attaches the intro to the Pages section', () => {
    const sections = buildWebSections([]);
    const pages = sections.find((s) => s.heading === 'Pages');
    expect(pages?.intro).toBe(WEB_LLMS_PAGES_INTRO);
  });
});

describe('legal SEO contract', () => {
  beforeEach(() => {
    // Legal directives do not depend on the growing marketing content tree.
    vi.spyOn(contentRegistry, 'publishedMarketingContent').mockReturnValue([]);
  });

  for (const locale of SUPPORTED_LOCALES) {
    it(`keeps ${locale} legal Markdown out of the index for GET, HEAD and conditional requests`, async () => {
      const server = createMarketingArtifactsServer({
        ssr: { render: vi.fn() },
      });
      const url = `https://tale.dev${localizedPath(locale, '/legal/privacy-policy.md')}`;
      const response = await server.handle(new Request(url));
      expect(response?.status).toBe(200);
      expect(response?.headers.get('x-robots-tag')).toBe('noindex, nofollow');
      expect(response?.headers.get('content-type')).toContain('text/markdown');
      expect((await response?.text())?.length).toBeGreaterThan(100);
      const head = await server.handle(new Request(url, { method: 'HEAD' }));
      expect(head?.status).toBe(200);
      expect(head?.headers.get('x-robots-tag')).toBe('noindex, nofollow');
      const etag = response?.headers.get('etag');
      expect(etag).toBeTruthy();
      const conditional = await server.handle(
        new Request(url, {
          headers: { 'if-none-match': etag ?? '' },
        }),
      );
      expect(conditional?.status).toBe(304);
      expect(conditional?.headers.get('x-robots-tag')).toBe(
        'noindex, nofollow',
      );
      expect(conditional?.headers.get('etag')).toBe(etag);
      expect(await conditional?.text()).toBe('');
    });
  }

  it('lets crawlers read legal noindex tags while retaining private endpoint exclusions', async () => {
    const render = vi.fn();
    const server = createMarketingArtifactsServer({ ssr: { render } });
    const response = await server.handle(
      new Request('https://tale.dev/robots.txt'),
    );
    expect(response?.status).toBe(200);
    const robots = await response?.text();
    expect(robots).toContain('Allow: /');
    expect(robots).toContain('Disallow: /api/');
    expect(robots).toContain('Disallow: /_search/');
    expect(robots).not.toMatch(/^Disallow:.*\/legal\//m);
    expect(robots).toContain('Sitemap: https://tale.dev/sitemap.xml');
    expect(robots).toContain('Sitemap: https://docs.tale.dev/sitemap.xml');
    expect(render).not.toHaveBeenCalled();
  });

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
  });
});

it('directs LLM readers to the current crawlable release feed', () => {
  expect(webOptionalPages()).toContainEqual({
    title: 'Current releases (JSON; includes source and fetch time)',
    url: 'https://tale.dev/changelog.json',
  });
});
