import { afterAll, describe, expect, test } from 'bun:test';

import { crawlSite } from './crawl.ts';

// A tiny site with one of every problem the crawl reports.
const PAGES: Record<string, string> = {
  '/': `<a href="/guide">Guide</a> <a href="/old">Old</a>
        <a href="https://docs.example.test/guide#setup">Aliased</a>
        <a href="/guide#nowhere">Bad fragment</a>
        <img src="/missing.webp" alt="">
        <script type="application/ld+json">{"url":"/only-in-json"}</script>
        <a href="https://elsewhere.example/x">External</a>`,
  '/guide': '<h2 id="setup">Setup</h2>',
};
const server = Bun.serve({
  port: 0,
  fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === '/old') {
      return new Response(null, {
        status: 301,
        headers: { Location: '/guide' },
      });
    }
    if (pathname === '/llms.txt') {
      return new Response('- [Gone](https://docs.example.test/gone.md)', {
        headers: { 'content-type': 'text/plain' },
      });
    }
    const html = PAGES[pathname];
    return html
      ? new Response(html, { headers: { 'content-type': 'text/html' } })
      : new Response('not found', { status: 404 });
  },
});
afterAll(() => server.stop(true));

describe('crawlSite', () => {
  test('reports broken links, links through a redirect and missing ids', async () => {
    const report = await crawlSite({
      origin: `http://127.0.0.1:${server.port}`,
      aliases: ['https://docs.example.test'],
      seeds: ['/', '/llms.txt'],
    });
    expect(report.pages).toBe(2);
    expect(report.truncated).toBe(false);
    const found = report.findings
      .map(({ rule, target, from }) => `${rule} ${target} <- ${from.join(',')}`)
      .sort();
    expect(found).toEqual([
      'broken-link /gone.md <- /llms.txt',
      'broken-link /missing.webp <- /',
      'fragment-missing /guide#nowhere <- /',
      'redirected-link /old <- /',
    ]);
  });

  test('stops at maxUrls and says so', async () => {
    const report = await crawlSite({
      origin: `http://127.0.0.1:${server.port}`,
      seeds: ['/'],
      maxUrls: 2,
    });
    expect(report.truncated).toBe(true);
  });
});
