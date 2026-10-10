import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ALL_LOCALES } from '@tale/ui/i18n/locales';
import { createPrecompiledServer } from '@tale/ui/seo';
import { resolveFullTitle } from '@tale/ui/seo/document-meta';
import { TALE_SITE_URL } from '@tale/ui/seo/globals';
import { extractInlineScriptHashes } from '@tale/ui/server';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import { RELEASES } from '../../app/generated/releases-manifest';
import {
  publishedMarketingContent,
  readMarketingContent,
} from '../../lib/content/server';
import { localizedPath, SUPPORTED_LOCALES } from '../../lib/i18n/locales';
import { UI_DOCS_ENTRY_PATHS } from '../../lib/redirects';
import {
  prerenderedBodyCount,
  RELEASE_DISPLAY_LIMIT,
} from '../../lib/releases/prerender-budget';
import { withLegalArtifactNoindex } from '../../lib/seo/legal-artifacts';
import {
  MARKETING_ROUTE_URLS,
  marketingRoutesForLocale,
} from '../../lib/seo/marketing-routes';
import { enumerateLegalRoutes } from '../../scripts/legal-routes';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DIST = join(ROOT, 'dist');
const SEO_DIST = join(ROOT, 'dist-seo');
const MARKETING_ROUTES = SUPPORTED_LOCALES.flatMap((locale) =>
  marketingRoutesForLocale(locale).map((route) =>
    Object.assign(route, { locale }),
  ),
);

function distIndex(url: string): string {
  if (url === '/') return join(DIST, 'index.html');
  return join(DIST, url.replace(/^\//, ''), 'index.html');
}

function readHtml(url: string): string | null {
  const path = distIndex(url);
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8');
}

function localeAlternates(path: string): Record<string, string> {
  return Object.fromEntries([
    ...SUPPORTED_LOCALES.map((locale) => [
      locale,
      `${TALE_SITE_URL}${localizedPath(locale, path)}`,
    ]),
    ['x-default', `${TALE_SITE_URL}${path}`],
  ]);
}

function htmlAlternates(path: string): Record<string, string> {
  const alternates = localeAlternates(path);
  return {
    ...alternates,
    // Regional aliases use their base locale's URL rather than extra routes.
    ...Object.fromEntries(
      ALL_LOCALES.map((locale) => [
        locale,
        alternates[locale] ?? alternates[locale.split('-')[0]],
      ]),
    ),
  };
}

describe('prerender SEO suite', () => {
  describe('published Markdown content in every locale', () => {
    const published = publishedMarketingContent();
    const sourceByUrl = new Map(
      readMarketingContent().map((page) => [page.url, page]),
    );

    for (const page of published) {
      it(`${page.url} renders its exact metadata, body and search artifacts`, () => {
        const html = readHtml(page.url);
        expect(html, `missing ${distIndex(page.url)}`).not.toBeNull();
        const dom = new JSDOM(html ?? '');
        try {
          const document = dom.window.document;
          expect(document.querySelectorAll('h1')).toHaveLength(1);
          expect(document.querySelector('h1')?.textContent).toBe(
            page.frontmatter.title.replace(/ \| Tale$/, ''),
          );
          expect(document.title).toBe(resolveFullTitle(page.frontmatter.title));
          expect(
            document
              .querySelector('meta[name="description"]')
              ?.getAttribute('content'),
          ).toBe(page.frontmatter.description);
          expect(document.documentElement.lang).toBe(page.locale);
          expect(
            document
              .querySelector('link[rel="canonical"]')
              ?.getAttribute('href'),
          ).toBe(`${TALE_SITE_URL}${page.url}`);
          expect(
            document
              .querySelector('meta[name="robots"]')
              ?.getAttribute('content') ?? '',
          ).not.toContain('noindex');
          const alternates = Object.fromEntries(
            [
              ...document.querySelectorAll('link[rel="alternate"][hreflang]'),
            ].map((link) => [
              link.getAttribute('hreflang'),
              link.getAttribute('href'),
            ]),
          );
          expect(alternates).toEqual(htmlAlternates(page.path));
          const schema = [
            ...document.querySelectorAll('script[type="application/ld+json"]'),
          ]
            .map((script) => script.textContent)
            .join('\n');
          expect(schema).toContain('"@type":"WebPage"');
          expect(schema).toContain('"@type":"BreadcrumbList"');
          expect(schema).not.toMatch(
            /"@type":"(?:Review|AggregateRating|Rating)"/,
          );
          expect(schema).not.toMatch(
            /"(?:reviewRating|aggregateRating|ratingValue)"\s*:/,
          );
          const heading = sourceByUrl
            .get(page.url)
            ?.content.match(/^## (.+)$/m)?.[1];
          expect(heading).toBeTruthy();
          const isComparisonHub =
            page.category === 'comparisons' && page.slug === 'index';
          expect(
            document.querySelector(isComparisonHub ? 'main' : 'article')
              ?.textContent,
          ).toContain(heading);
          const markdown = readFileSync(
            join(SEO_DIST, `${page.url.slice(1)}.md`),
            'utf8',
          );
          if (isComparisonHub) {
            const directory = document.querySelector(
              'main section[aria-labelledby]',
            );
            const directoryHeading = directory?.querySelector('h2');
            expect(directoryHeading?.textContent).toBeTruthy();
            expect(directory?.getAttribute('aria-labelledby')).toBe(
              directoryHeading?.id,
            );
            expect(markdown).toContain(directoryHeading?.textContent);
            const guides = published.filter(
              (guide) =>
                guide.category === 'comparisons' &&
                guide.slug !== 'index' &&
                guide.locale === page.locale,
            );
            const links = [...(directory?.querySelectorAll('li a') ?? [])];
            expect(
              links
                .map((link) => link.getAttribute('href'))
                .sort((left, right) => (left ?? '').localeCompare(right ?? '')),
            ).toEqual(guides.map((guide) => guide.url).sort());
            for (const guide of guides) {
              expect(
                links.find((link) => link.getAttribute('href') === guide.url)
                  ?.textContent,
              ).toContain(guide.frontmatter.competitor);
              expect(markdown).toContain(`(${TALE_SITE_URL}${guide.url})`);
              expect(markdown).toContain(guide.frontmatter.competitor);
            }
          }
          // The HTML-to-Markdown converter normalizes French nonbreaking
          // spaces; compare semantic heading text while keeping HTML exact.
          expect(markdown.replace(/\s+/g, ' ')).toContain(
            heading?.replace(/\s+/g, ' '),
          );
          expect(markdown).toContain(page.frontmatter.title);
          const sitemap = readFileSync(join(SEO_DIST, 'sitemap.xml'), 'utf8');
          expect(sitemap).toContain(`<loc>${TALE_SITE_URL}${page.url}</loc>`);
          const llms = readFileSync(join(SEO_DIST, 'llms.txt'), 'utf8');
          if (page.locale === 'en')
            expect(llms).toContain(`(${TALE_SITE_URL}${page.url}.md)`);
          else expect(llms).not.toContain(`(${TALE_SITE_URL}${page.url}.md)`);
          expect(
            readFileSync(join(SEO_DIST, 'llms-full.txt'), 'utf8'),
          ).toContain(`${TALE_SITE_URL}${page.url}`);
        } finally {
          dom.window.close();
        }
      });
    }
  });

  it('has a built dist/ (run web build first)', () => {
    expect(existsSync(DIST)).toBe(true);
  });

  it('prerenders /404 with noindex', () => {
    const html = readHtml('/404');
    expect(html).not.toBeNull();
    expect(html ?? '').toMatch(/noindex/i);
  });

  for (const path of UI_DOCS_ENTRY_PATHS) {
    it(`${path} has a static Tale UI redirect without indexable marketing content`, () => {
      const dom = new JSDOM(readHtml(path) ?? '');
      try {
        const document = dom.window.document;
        expect(
          document
            .querySelector('meta[http-equiv="refresh"]')
            ?.getAttribute('content'),
        ).toBe('0;url=https://ui.tale.dev');
        expect(
          document.querySelector('link[rel="canonical"]')?.getAttribute('href'),
        ).toBe('https://ui.tale.dev');
        expect(
          document
            .querySelector('meta[name="robots"]')
            ?.getAttribute('content'),
        ).toContain('noindex');
        expect(document.querySelectorAll('h1')).toHaveLength(0);
        expect(document.querySelector('a')?.getAttribute('href')).toBe(
          'https://ui.tale.dev',
        );
      } finally {
        dom.window.close();
      }
    });
  }

  for (const path of [
    '/missing',
    '/de/missing',
    '/fr/platform/missing',
    '/de/legal/missing',
  ]) {
    it(`${path} renders the marketing 404 in SSR with metadata and site chrome`, async () => {
      const { render } = (await import(`${ROOT}/dist-ssr/entry-server.js`)) as {
        render: (url: string) => Promise<{ html: string; head: string }>;
      };
      const result = await render(path);
      const dom = new JSDOM(
        `<html><head>${result.head}</head><body>${result.html}</body></html>`,
      );
      try {
        const document = dom.window.document;
        expect(document.querySelectorAll('main h1')).toHaveLength(1);
        expect(document.querySelector('main')?.textContent).not.toBe(
          'Not Found',
        );
        expect(document.querySelectorAll('header')).toHaveLength(1);
        expect(document.querySelectorAll('footer')).toHaveLength(1);
        expect(
          document
            .querySelector('meta[name="robots"]')
            ?.getAttribute('content'),
        ).toContain('noindex');
        const prefix = path.startsWith('/de/')
          ? '/de'
          : path.startsWith('/fr/')
            ? '/fr'
            : '';
        expect(
          document.querySelector('link[rel="canonical"]')?.getAttribute('href'),
        ).toBe(`https://tale.dev${prefix}/404`);
      } finally {
        dom.window.close();
      }
    });
  }

  it('ships og.png', () => {
    expect(existsSync(join(DIST, 'og.png'))).toBe(true);
  });

  for (const { url, path, locale, title, description } of MARKETING_ROUTES) {
    describe(url, () => {
      it('prerenders index.html with exactly one h1', () => {
        const html = readHtml(url);
        expect(html, `missing ${distIndex(url)}`).not.toBeNull();
        const h1s = (html ?? '').match(/<h1[\s>]/gi) ?? [];
        expect(h1s.length).toBe(1);
      });

      it('serves localized metadata, reciprocal language links and visible demos before JavaScript', () => {
        const dom = new JSDOM(readHtml(url) ?? '');
        try {
          const { document } = dom.window;
          const { head } = document;
          expect(document.documentElement.lang).toBe(locale);
          expect(head.querySelectorAll('title')).toHaveLength(1);
          expect(document.title).toBe(resolveFullTitle(title));
          expect(
            head.querySelectorAll('meta[name="description"]'),
          ).toHaveLength(1);
          expect(
            head
              .querySelector('meta[name="description"]')
              ?.getAttribute('content'),
          ).toBe(description);
          expect(head.querySelectorAll('link[rel="canonical"]')).toHaveLength(
            1,
          );
          expect(
            head.querySelector('link[rel="canonical"]')?.getAttribute('href'),
          ).toBe(`${TALE_SITE_URL}${url}`);
          expect(
            head
              .querySelector('meta[property="og:url"]')
              ?.getAttribute('content'),
          ).toBe(`${TALE_SITE_URL}${url}`);
          expect(
            head
              .querySelector('meta[property="og:description"]')
              ?.getAttribute('content'),
          ).toBe(description);
          expect(
            head.querySelector('meta[name="robots"]')?.getAttribute('content'),
          ).toBe('index,follow');
          const links = [
            ...head.querySelectorAll('link[rel="alternate"][hreflang]'),
          ];
          const expected = htmlAlternates(path);
          expect(links).toHaveLength(Object.keys(expected).length);
          expect(
            Object.fromEntries(
              links.map((link) => [
                link.getAttribute('hreflang'),
                link.getAttribute('href'),
              ]),
            ),
          ).toEqual(expected);
          // The timeline's final beat is not enough: an SSR motion child
          // with initial opacity zero still leaves a no-JS demo blank.
          const hiddenDemoContent = [
            ...document.querySelectorAll<HTMLElement>('[role="img"] [style]'),
          ].filter(
            (element) =>
              element.style.opacity === '0' &&
              !element.matches('input[aria-hidden="true"]'),
          );
          expect(hiddenDemoContent).toHaveLength(0);
        } finally {
          dom.window.close();
        }
      });

      // One image serves deployments with analytics enabled or disabled.
      // Only the runtime server may inject deployment-specific configuration;
      // the browser then loads the same-origin tracker after checking opt-outs.
      it('leaves analytics opt-in to runtime configuration', () => {
        const html = readHtml(url) ?? '';
        expect(html).not.toMatch(/\bdata-website-id=/);
        expect(html).not.toContain('id="tale-analytics"');
        expect(html).not.toMatch(/<script[^>]+src="\/_a\/script\.js"/);
      });
    });
  }

  it('sitemap lists exactly the indexable canonical URLs with complete language clusters', () => {
    const dom = new JSDOM(readFileSync(join(SEO_DIST, 'sitemap.xml'), 'utf8'), {
      contentType: 'text/xml',
    });
    try {
      const entries = [...dom.window.document.getElementsByTagName('url')];
      expect(
        entries
          .map((entry) => entry.querySelector('loc')?.textContent)
          .sort((left, right) => (left ?? '').localeCompare(right ?? '')),
      ).toEqual(
        MARKETING_ROUTES.map((route) => `${TALE_SITE_URL}${route.url}`).sort(
          (left, right) => left.localeCompare(right),
        ),
      );
      for (const route of MARKETING_ROUTES) {
        const entry = entries.find(
          (node) =>
            node.querySelector('loc')?.textContent ===
            `${TALE_SITE_URL}${route.url}`,
        );
        const links = [...(entry?.getElementsByTagName('xhtml:link') ?? [])];
        expect(links).toHaveLength(SUPPORTED_LOCALES.length + 1);
        expect(
          Object.fromEntries(
            links.map((link) => [
              link.getAttribute('hreflang'),
              link.getAttribute('href'),
            ]),
          ),
        ).toEqual(localeAlternates(route.path));
      }
    } finally {
      dom.window.close();
    }
  });

  it('keeps legal pages crawlable so their noindex directives take effect in every locale', async () => {
    const robots = readFileSync(join(SEO_DIST, 'robots.txt'), 'utf8');
    expect(robots).toContain('Allow: /');
    expect(robots).not.toMatch(/^Disallow:.*\/legal\//m);
    expect(robots).toContain('Disallow: /api/');
    expect(robots).toContain('Disallow: /_search/');
    const sitemap = readFileSync(join(SEO_DIST, 'sitemap.xml'), 'utf8');
    for (const route of await enumerateLegalRoutes()) {
      const html = readHtml(route.url);
      expect(html, `missing ${distIndex(route.url)}`).not.toBeNull();
      const dom = new JSDOM(html ?? '');
      try {
        const { document } = dom.window;
        expect(document.documentElement.lang).toBe(route.locale);
        expect(
          document.head
            .querySelector('meta[name="robots"]')
            ?.getAttribute('content'),
        ).toBe('noindex,nofollow');
        expect(document.head.querySelectorAll('link[hreflang]')).toHaveLength(
          0,
        );
        expect(sitemap).not.toContain(
          `<loc>${TALE_SITE_URL}${route.url}</loc>`,
        );
      } finally {
        dom.window.close();
      }
    }
  });

  it('serves precompiled legal Markdown with noindex headers without changing public artifact indexing', async () => {
    const server = withLegalArtifactNoindex(
      await createPrecompiledServer({ dir: SEO_DIST }),
    );
    for (const route of await enumerateLegalRoutes()) {
      const url = `${TALE_SITE_URL}${route.url}.md`;
      const response = await server.handle(new Request(url));
      expect(response?.status, url).toBe(200);
      expect(response?.headers.get('x-robots-tag'), url).toBe(
        'noindex, nofollow',
      );
      expect(response?.headers.get('content-type'), url).toContain(
        'text/markdown',
      );
      expect((await response?.text())?.length, url).toBeGreaterThan(100);
    }
    for (const path of [
      '/pricing.md',
      '/de/pricing.md',
      '/fr/pricing.md',
      '/llms.txt',
      '/sitemap.xml',
    ]) {
      const response = await server.handle(
        new Request(`${TALE_SITE_URL}${path}`),
      );
      expect(response?.status, path).toBe(200);
      expect(response?.headers.get('x-robots-tag'), path).toBeNull();
    }
    expect(
      await server.handle(new Request(`${TALE_SITE_URL}/legal/missing.md`)),
    ).toBeNull();
  });

  it('keeps uncompressed hashed JavaScript under 2.5MB total', () => {
    const assets = join(DIST, 'assets');
    if (!existsSync(assets)) return;
    let total = 0;
    for (const name of readdirSync(assets)) {
      if (!name.endsWith('.js')) continue;
      total += statSync(join(assets, name)).size;
    }
    // Soft budget on uncompressed hashed JS — catches accidental mega-chunks.
    expect(total).toBeLessThan(2_500_000);
  });

  for (const path of ['/changelog', '/de/changelog', '/fr/changelog']) {
    it(`${path} advertises the crawlable live JSON feed without JavaScript`, () => {
      const html = readHtml(path) ?? '';
      expect(html).toMatch(
        /<link rel="alternate" type="application\/json"[^>]*href="https:\/\/tale\.dev\/changelog\.json"/,
      );
    });
  }

  describe('JSON-LD regressions', () => {
    it('homepage declares Organization + WebSite + SoftwareApplication + FAQPage', () => {
      const html = readHtml('/');
      expect(html).not.toBeNull();
      expect(html ?? '').toMatch(/"@type":"Organization"/);
      expect(html ?? '').toMatch(/"@type":"WebSite"/);
      expect(html ?? '').toMatch(/"@type":"SoftwareApplication"/);
      expect(html ?? '').toMatch(/"@type":"FAQPage"/);
    });

    it('pricing declares BreadcrumbList + FAQPage + SoftwareApplication', () => {
      const html = readHtml('/pricing');
      expect(html).not.toBeNull();
      expect(html ?? '').toMatch(/"@type":"BreadcrumbList"/);
      expect(html ?? '').toMatch(/"@type":"FAQPage"/);
      expect(html ?? '').toMatch(/"@type":"SoftwareApplication"/);
    });

    it('platform agents declares FAQPage + BreadcrumbList', () => {
      const html = readHtml('/platform/agents');
      expect(html).not.toBeNull();
      expect(html ?? '').toMatch(/"@type":"FAQPage"/);
      expect(html ?? '').toMatch(/"@type":"BreadcrumbList"/);
    });

    it('platform hub declares FAQPage + BreadcrumbList', () => {
      const html = readHtml('/platform');
      expect(html).not.toBeNull();
      expect(html ?? '').toMatch(/"@type":"FAQPage"/);
      expect(html ?? '').toMatch(/"@type":"BreadcrumbList"/);
    });

    it('changelog declares ItemList of releases', () => {
      const html = readHtml('/changelog');
      expect(html).not.toBeNull();
      expect(html ?? '').toMatch(/"@type":"ItemList"/);
      expect(html ?? '').toMatch(/"@type":"BreadcrumbList"/);
    });

    it('localized pricing keeps locale-prefixed canonical + breadcrumb', () => {
      const html = readHtml('/de/pricing');
      expect(html).not.toBeNull();
      expect(html).toMatch(/lang="de"/i);
      expect(html).toMatch(
        /rel="canonical"[^>]+href="https:\/\/tale\.dev\/de\/pricing"/i,
      );
      expect(html).toMatch(/"@type":"BreadcrumbList"/);
      expect(html).toMatch(/https:\/\/tale\.dev\/de\/pricing/);
    });
  });

  // Regression: the changelog prerendered all 40 release bodies, putting
  // ~400 KB of GitHub release notes into the HTML and growing with every
  // release. Ahrefs flags it as a slow page. Every release stays in the
  // stream; only the newest bodies within `prerenderedBodyCount`'s byte
  // budget are prerendered, the rest mount on hydration from the manifest
  // the JS bundle already ships.
  describe('changelog page weight', () => {
    // The shared stream bound and body budget apply to the manifest fetched
    // (`bun run build` refreshes it before prerendering).
    const PRERENDERED_BODIES = prerenderedBodyCount(
      RELEASES.slice(0, RELEASE_DISPLAY_LIMIT),
    );
    const MARKDOWN_BODY_COUNT = RELEASES.slice(0, PRERENDERED_BODIES).filter(
      ({ body }) => Boolean(body),
    ).length;
    for (const url of ['/changelog', '/de/changelog', '/fr/changelog']) {
      it(`${url} lists every release but prerenders a bounded set of bodies`, () => {
        const html = readHtml(url);
        expect(html, `missing ${distIndex(url)}`).not.toBeNull();
        const found = html ?? '';

        expect((found.match(/<article/g) ?? []).length).toBe(
          RELEASE_DISPLAY_LIMIT,
        );
        // Count rendered release bodies independently of typography classes.
        const document = new JSDOM(found).window.document;
        expect(
          document.querySelectorAll('article [data-release-body]'),
        ).toHaveLength(MARKDOWN_BODY_COUNT);
        // The budget is a bound, never a reason to prerender nothing.
        expect(PRERENDERED_BODIES).toBeGreaterThanOrEqual(1);
      });

      it(`${url} stays under the HTML size budget`, () => {
        const html = readHtml(url);
        if (!html) return;
        // Was 407 KB with every body prerendered; 216 KB with a fixed
        // twelve, until the 0.5.x fix releases' notes grew and the same
        // twelve weighed 308 KB; ~245 KB under the byte budget.
        expect(html.length).toBeLessThan(300_000);
      });
    }
  });

  // The server computes CSP script-src sha256 hashes once, from dist/index.html.
  // That's only safe if every prerendered page's inline scripts are a subset of
  // the template's — otherwise a page's theme script would be CSP-blocked.
  describe('CSP inline-script hashing', () => {
    it('template has at least one inline (theme) script to hash', () => {
      const html = readHtml('/');
      if (!html) return;
      expect(extractInlineScriptHashes(html).length).toBeGreaterThan(0);
    });

    it('every route’s inline scripts are a subset of the template’s', () => {
      const templateHtml = readHtml('/');
      if (!templateHtml) return;
      const template = new Set(extractInlineScriptHashes(templateHtml));
      for (const url of MARKETING_ROUTE_URLS) {
        const html = readHtml(url);
        if (!html) continue;
        for (const hash of extractInlineScriptHashes(html)) {
          expect(
            template,
            `${url} has an inline script not in the template`,
          ).toContain(hash);
        }
      }
    });
  });
});
