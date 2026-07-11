import { describe, expect, it } from 'vitest';

import { extractSameDomainLinks } from './discovery';

const BASE = 'https://docs.example.com/guide/intro';
const HOST = 'docs.example.com';

describe('extractSameDomainLinks', () => {
  it('resolves relative hrefs against the base URL', () => {
    const html = `<a href="../guide/setup">Setup</a><a href="./page.html">Page</a>`;
    const links = extractSameDomainLinks(html, BASE, HOST);
    expect(links).toContain('https://docs.example.com/guide/setup');
    expect(links).toContain('https://docs.example.com/guide/page.html');
  });

  it('keeps absolute same-host links and drops the fragment', () => {
    const html = `<a href="https://docs.example.com/other#section-2">Other</a>`;
    expect(extractSameDomainLinks(html, BASE, HOST)).toEqual([
      'https://docs.example.com/other',
    ]);
  });

  it('treats a leading www. as the same host for the match check (URL kept as-is)', () => {
    const html = `<a href="https://www.docs.example.com/other">Other</a>`;
    expect(extractSameDomainLinks(html, BASE, HOST)).toEqual([
      'https://www.docs.example.com/other',
    ]);
  });

  it('drops off-host links', () => {
    const html = `<a href="https://other-site.com/page">Elsewhere</a>`;
    expect(extractSameDomainLinks(html, BASE, HOST)).toEqual([]);
  });

  it('drops non-http(s) schemes (mailto, tel, javascript)', () => {
    const html = `
      <a href="mailto:hi@example.com">Mail</a>
      <a href="tel:+15555550100">Call</a>
      <a href="javascript:void(0)">Void</a>
    `;
    expect(extractSameDomainLinks(html, BASE, HOST)).toEqual([]);
  });

  it('skips anchors with an empty or absent href', () => {
    const html = `<a href="">Empty</a><a>No href at all</a>`;
    expect(extractSameDomainLinks(html, BASE, HOST)).toEqual([]);
  });

  it('skips hrefs that fail URL resolution', () => {
    const html = `<a href="http://[not-a-valid-host">Broken</a>`;
    expect(extractSameDomainLinks(html, BASE, HOST)).toEqual([]);
  });

  it('decodes HTML entities in href query strings (e.g. &amp;)', () => {
    const html = `<a href="/search?q=cats&amp;page=2">Search</a>`;
    expect(extractSameDomainLinks(html, BASE, HOST)).toEqual([
      'https://docs.example.com/search?q=cats&page=2',
    ]);
  });

  it('recovers same-host links from malformed markup (unclosed tags, unquoted attrs)', () => {
    const html = `
      <div class=nav>
        <a href=/guide/next>Next
        <a href="/guide/prev">Prev</a>
      </div>
    `;
    const links = extractSameDomainLinks(html, BASE, HOST);
    expect(links).toContain('https://docs.example.com/guide/next');
    expect(links).toContain('https://docs.example.com/guide/prev');
  });

  it('dedupes nothing itself but preserves document order', () => {
    const html = `<a href="/a">A</a><a href="/b">B</a><a href="/a">A again</a>`;
    expect(extractSameDomainLinks(html, BASE, HOST)).toEqual([
      'https://docs.example.com/a',
      'https://docs.example.com/b',
      'https://docs.example.com/a',
    ]);
  });
});
