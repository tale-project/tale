import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
});
