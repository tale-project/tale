import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ALL_LOCALES } from '@tale/ui/i18n/locales';
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
import {
  prerenderedBodyCount,
  RELEASE_DISPLAY_LIMIT,
} from '../../lib/releases/prerender-budget';
import { MARKETING_ROUTE_URLS } from '../../lib/seo/marketing-routes';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DIST = join(ROOT, 'dist');
const SEO_DIST = join(ROOT, 'dist-seo');

function distIndex(url: string): string {
  if (url === '/') return join(DIST, 'index.html');
  return join(DIST, url.replace(/^\//, ''), 'index.html');
}

function readHtml(url: string): string | null {
  const path = distIndex(url);
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8');
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
            page.frontmatter.title,
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
          const baseAlternates = Object.fromEntries(
            SUPPORTED_LOCALES.map((locale) => [
              locale,
              `${TALE_SITE_URL}${localizedPath(locale, page.path)}`,
            ]),
          );
          expect(alternates).toEqual({
            // Shared head tags also advertise regional aliases (de-CH uses
            // the German URL); regional variants do not create extra routes.
            ...Object.fromEntries(
              ALL_LOCALES.map((locale) => [
                locale,
                baseAlternates[locale] ?? baseAlternates[locale.split('-')[0]],
              ]),
            ),
            'x-default': `${TALE_SITE_URL}${page.path}`,
          });
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
          expect(document.querySelector('article')?.textContent).toContain(
            heading,
          );
          const markdown = readFileSync(
            join(SEO_DIST, `${page.url.slice(1)}.md`),
            'utf8',
          );
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

  it('ships og.png', () => {
    expect(existsSync(join(DIST, 'og.png'))).toBe(true);
  });

  for (const url of MARKETING_ROUTE_URLS) {
    describe(url, () => {
      it('prerenders index.html with exactly one h1', () => {
        const html = readHtml(url);
        expect(html, `missing ${distIndex(url)}`).not.toBeNull();
        const h1s = (html ?? '').match(/<h1[\s>]/gi) ?? [];
        expect(h1s.length).toBe(1);
      });

      it('sets html lang', () => {
        const html = readHtml(url);
        expect(html ?? '').toMatch(/<html[^>]+lang="/i);
      });

      it('has a canonical link', () => {
        const html = readHtml(url);
        expect(html ?? '').toMatch(/rel="canonical"/i);
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
      if (!html) return; // dist may be English-only in partial local builds
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
    // The prose wrapper ReleaseBody renders — one per rendered body.
    const BODY_MARKER = /max-w-none text-\[15px\]/g;

    for (const url of ['/changelog', '/de/changelog', '/fr/changelog']) {
      it(`${url} lists every release but prerenders a bounded set of bodies`, () => {
        const html = readHtml(url);
        expect(html, `missing ${distIndex(url)}`).not.toBeNull();
        const found = html ?? '';

        expect((found.match(/<article/g) ?? []).length).toBe(
          RELEASE_DISPLAY_LIMIT,
        );
        expect((found.match(BODY_MARKER) ?? []).length).toBe(
          PRERENDERED_BODIES,
        );
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
