import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractInlineScriptHashes } from '@tale/ui/server';
import { describe, expect, it } from 'vitest';

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

describe('docs prerender SEO suite', () => {
  it('has a built dist/ (run docs build first)', () => {
    expect(existsSync(DIST)).toBe(true);
  });

  // Regression: the `<title>` was the bare frontmatter title, which also
  // labels the sidebar, breadcrumb and H1 and is therefore short on purpose.
  // Pages rendered as little as 11 characters ("Chat | Tale"), which Ahrefs
  // reports as "Title too short". Titles now trail their top-level section.
  describe('title lengths', () => {
    // Rendered bounds. The floor sits below the docs root title
    // ("Tale documentation", 18) and well above the 11-character titles
    // that regressed; the ceiling is what a search result shows in full.
    const MIN = 15;
    const MAX = 60;

    function indexablePages(): { path: string; title: string }[] {
      const out: { path: string; title: string }[] = [];
      const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(full);
            continue;
          }
          if (entry.name !== 'index.html') continue;
          const html = readFileSync(full, 'utf8');
          // Redirect stubs and /404 are noindex; they are not results.
          if (/name="robots"[^>]*content="[^"]*noindex/i.test(html)) continue;
          const match = /<title>([\s\S]*?)<\/title>/.exec(html);
          if (!match) continue;
          out.push({
            path: full.slice(DIST.length),
            title: match[1]
              .replaceAll('&amp;', '&')
              .replaceAll('&lt;', '<')
              .replaceAll('&gt;', '>')
              .replaceAll('&#39;', "'")
              .replaceAll('&quot;', '"'),
          });
        }
      };
      walk(DIST);
      return out;
    }

    it('renders every indexable title within the bounds', () => {
      if (!existsSync(DIST)) return;
      const pages = indexablePages();
      expect(pages.length).toBeGreaterThan(100);
      const offenders = pages
        .filter((p) => p.title.length < MIN || p.title.length > MAX)
        .map((p) => `${p.path} (${p.title.length}): ${p.title}`);
      expect(offenders).toEqual([]);
    });
  });

  it('prerenders /404 with noindex', () => {
    const html = readHtml('/404');
    expect(html).not.toBeNull();
    expect(html ?? '').toMatch(/noindex/i);
  });

  describe('/', () => {
    it('prerenders with exactly one h1, lang, and canonical', () => {
      const html = readHtml('/');
      expect(html, `missing ${distIndex('/')}`).not.toBeNull();
      const h1s = (html ?? '').match(/<h1[\s>]/gi) ?? [];
      expect(h1s.length).toBe(1);
      expect(html ?? '').toMatch(/<html[^>]+lang="en"/i);
      expect(html ?? '').toMatch(/rel="canonical"/i);
    });

    it('declares Article + BreadcrumbList + WebSite JSON-LD', () => {
      const html = readHtml('/');
      expect(html).not.toBeNull();
      expect(html ?? '').toMatch(/"@type":"Article"/);
      expect(html ?? '').toMatch(/"@type":"BreadcrumbList"/);
      expect(html ?? '').toMatch(/"@type":"WebSite"/);
    });
  });

  it('localized platform page keeps locale-prefixed canonical', () => {
    const html = readHtml('/de/platform/chat/basics');
    if (!html) return; // slug may move; skip when absent
    expect(html).toMatch(/lang="de"/i);
    expect(html).toMatch(
      /rel="canonical"[^>]+href="[^"]*\/de\/platform\/chat\/basics"/i,
    );
  });

  it('legal privacy is noindex', () => {
    const html = readHtml('/legal/privacy');
    if (!html) return;
    expect(html).toMatch(/noindex/i);
  });

  // The server hashes CSP script-src once from dist/index.html; every
  // prerendered page's inline scripts must be a subset or they'd be blocked.
  describe('CSP inline-script hashing', () => {
    function allIndexHtml(dir: string, acc: string[] = []): string[] {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) allIndexHtml(full, acc);
        else if (entry.name === 'index.html') acc.push(full);
      }
      return acc;
    }

    it('template has at least one inline (theme) script to hash', () => {
      const html = readHtml('/');
      if (!html) return;
      expect(extractInlineScriptHashes(html).length).toBeGreaterThan(0);
    });

    it('every prerendered page’s inline scripts are a subset of the template’s', () => {
      const templateHtml = readHtml('/');
      if (!templateHtml || !existsSync(DIST)) return;
      const template = new Set(extractInlineScriptHashes(templateHtml));
      for (const path of allIndexHtml(DIST)) {
        const html = readFileSync(path, 'utf8');
        for (const hash of extractInlineScriptHashes(html)) {
          expect(
            template,
            `${path} has an inline script not in the template`,
          ).toContain(hash);
        }
      }
    });
  });
});
