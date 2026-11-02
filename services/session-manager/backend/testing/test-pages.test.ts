import { afterEach, describe, expect, it } from 'vitest';

import { startTestPages } from './test-pages.ts';
import type { TestPages } from './test-pages.ts';

const started: TestPages[] = [];

async function serve(slowMs?: number): Promise<TestPages> {
  const pages = await startTestPages({ slowMs });
  started.push(pages);
  return pages;
}

afterEach(async () => {
  for (const pages of started.splice(0)) await pages.close();
});

describe('test pages', () => {
  it('listen on a free port of 127.0.0.1', async () => {
    const first = await serve();
    const second = await serve();
    expect(first.port).toBeGreaterThan(0);
    expect(second.port).not.toBe(first.port);
    expect(first.url('/form.html')).toBe(
      `http://127.0.0.1:${first.port}/form.html`,
    );
    expect(first.url('/form.html', 'probe.test')).toBe(
      `http://probe.test:${first.port}/form.html`,
    );
  });

  it.each([
    ['/form.html', 'text/html; charset=utf-8', '<title>form</title>'],
    ['/storage.html', 'text/html; charset=utf-8', '<title>storage</title>'],
    ['/dialogs.html', 'text/html; charset=utf-8', "confirm('Sure?')"],
    ['/lists.html', 'text/html; charset=utf-8', 'id="multiple" multiple'],
    ['/links.html', 'text/html; charset=utf-8', 'target="_blank"'],
    ['/read.html', 'text/html; charset=utf-8', 'role="button"'],
    ['/geo.html', 'text/html; charset=utf-8', 'navigator.geolocation'],
    ['/probe.html', 'text/html; charset=utf-8', '/probe.js'],
    ['/probe.js', 'text/javascript; charset=utf-8', 'window.__fpProbe = async'],
    ['/long.html', 'text/html; charset=utf-8', '>row 399</div>'],
  ])('serve %s as %s', async (path, type, content) => {
    const pages = await serve();
    const response = await fetch(pages.url(path));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(type);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toContain(content);
  });

  it('ignore the query when they look for a page', async () => {
    const pages = await serve();
    const response = await fetch(pages.url('/probe.html?s=a'));
    expect(response.status).toBe(200);
    await response.text();
  });

  it('answer 404 for anything else', async () => {
    const pages = await serve();
    const response = await fetch(pages.url('/nothing.html'));
    expect(response.status).toBe(404);
    await response.text();
  });

  it('make a tall page of 400 different screens', async () => {
    const pages = await serve();
    const html = await (await fetch(pages.url('/long.html'))).text();
    expect(html.match(/<div /g)).toHaveLength(400);
    expect(new Set(html.match(/hsl\([^)]*\)/g)).size).toBeGreaterThan(50);
  });

  it('keep the slow page waiting before they answer', async () => {
    const pages = await serve(150);
    const asked = performance.now();
    const response = await fetch(pages.url('/slow.html'));
    await response.text();
    expect(performance.now() - asked).toBeGreaterThanOrEqual(140);
    expect(response.status).toBe(200);
  });

  it('drop a page that is still waiting when they close', async () => {
    const pages = await startTestPages({ slowMs: 60_000 });
    const waiting = fetch(pages.url('/slow.html')).then(
      () => 'answered',
      () => 'dropped',
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    await pages.close();
    expect(await waiting).toBe('dropped');
  });
});
