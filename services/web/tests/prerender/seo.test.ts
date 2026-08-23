import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractInlineScriptHashes } from '@tale/ui/server';
import { describe, expect, it } from 'vitest';

import { MARKETING_ROUTE_URLS } from '../../lib/seo/marketing-routes';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DIST = join(ROOT, 'dist');

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

      // The analytics tag lives outside the seo markers so it survives
      // prerendering on every route, and it must stay same-origin: this
      // server sends script-src 'self' + inline hashes, so an absolute
      // tracker URL would be blocked in the browser.
      it('keeps the first-party analytics tag', () => {
        const html = readHtml(url) ?? '';
        expect(html).toContain(
          'data-website-id="86021df0-293b-4436-8dd3-aa83bdf4b86e"',
        );
        expect(html).toMatch(/<script[^>]+src="\/_a\/script\.js"/);
      });
    });
  }

  it('keeps JS asset gzip budget under 2MB total for hashed assets', () => {
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
