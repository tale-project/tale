import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { crawlSite, startSiteServer } from './crawl.ts';

async function failureOf(operation: Promise<unknown>): Promise<Error> {
  try {
    await operation;
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
  throw new Error('Expected the operation to reject');
}

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

  test('uses the requested concurrency after discovering a single seed frontier', async () => {
    let active = 0;
    let peak = 0;
    const fixture = Bun.serve({
      port: 0,
      async fetch(request) {
        const { pathname } = new URL(request.url);
        if (pathname === '/')
          return new Response(
            '<a href="/one">One</a><a href="/two">Two</a><a href="/three">Three</a>',
            {
              headers: { 'content-type': 'text/html' },
            },
          );
        active += 1;
        peak = Math.max(peak, active);
        await Bun.sleep(20);
        active -= 1;
        return new Response('ok');
      },
    });
    try {
      const report = await crawlSite({
        origin: `http://127.0.0.1:${fixture.port}`,
        seeds: ['/'],
        concurrency: 2,
      });
      expect(report.fetched).toBe(4);
      expect(peak).toBe(2);
    } finally {
      await fixture.stop(true);
    }
  });

  test.each([undefined, 2])(
    'counts and deduplicates in-flight addresses (maxUrls=%s)',
    async (maxUrls) => {
      const requests: string[] = [];
      const fixture = Bun.serve({
        port: 0,
        async fetch(request) {
          const { pathname } = new URL(request.url);
          requests.push(pathname);
          await Bun.sleep(pathname === '/slow' ? 30 : 5);
          return new Response(
            pathname === '/'
              ? '<a href="/">Self</a><a href="/slow">Slow</a><a href="/extra">Extra</a>'
              : 'ok',
            {
              headers: { 'content-type': 'text/html' },
            },
          );
        },
      });
      try {
        const report = await crawlSite({
          origin: `http://127.0.0.1:${fixture.port}`,
          seeds: ['/', '/slow'],
          maxUrls,
          concurrency: 2,
        });
        expect(requests.filter((path) => path === '/')).toHaveLength(1);
        expect(requests.filter((path) => path === '/slow')).toHaveLength(1);
        expect(requests).toHaveLength(maxUrls ?? 3);
        expect(report.fetched).toBe(requests.length);
        expect(report.truncated).toBe(maxUrls === 2);
      } finally {
        await fixture.stop(true);
      }
    },
  );

  test('a slow response does not hold an available slot for newly discovered links', async () => {
    let slowFinished = false;
    let childStartedBeforeSlow = false;
    const fixture = Bun.serve({
      port: 0,
      async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === '/slow') {
          await Bun.sleep(50);
          slowFinished = true;
        }
        if (path === '/child') childStartedBeforeSlow = !slowFinished;
        const html =
          path === '/'
            ? '<a href="/slow">Slow</a><a href="/fast">Fast</a>'
            : path === '/fast'
              ? '<a href="/child">Child</a>'
              : 'ok';
        return new Response(html, { headers: { 'content-type': 'text/html' } });
      },
    });
    try {
      const report = await crawlSite({
        origin: `http://127.0.0.1:${fixture.port}`,
        seeds: ['/'],
        concurrency: 2,
      });
      expect(report.fetched).toBe(4);
      expect(childStartedBeforeSlow).toBe(true);
    } finally {
      await fixture.stop(true);
    }
  });

  test('literal percent fragments do not abort a built-site crawl', async () => {
    const fixture = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(
          '<a href="#literal%">Literal</a><h2 id="literal%">Target</h2>',
          {
            headers: { 'content-type': 'text/html' },
          },
        ),
    });
    try {
      const report = await crawlSite({
        origin: `http://127.0.0.1:${fixture.port}`,
        seeds: ['/'],
      });
      expect(report.fetched).toBe(1);
      expect(report.findings).toEqual([]);
    } finally {
      await fixture.stop(true);
    }
  });

  test('a response body failure becomes a broken-link finding', async () => {
    const fixture = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('<html>'));
              setTimeout(
                () => controller.error(new Error('fixture body interrupted')),
                5,
              );
            },
          }),
          { headers: { 'content-type': 'text/html' } },
        ),
    });
    try {
      const report = await crawlSite({
        origin: `http://127.0.0.1:${fixture.port}`,
        seeds: ['/'],
      });
      expect(report.findings).toEqual([
        { rule: 'broken-link', target: '/', status: 0, from: ['seed'] },
      ]);
    } finally {
      await fixture.stop(true);
    }
  });

  test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'invalid concurrency/URL budgets cannot produce an empty green crawl: %s',
    async (invalid) => {
      const options = {
        origin: `http://127.0.0.1:${server.port}`,
        seeds: ['/'],
      };
      expect(
        (await failureOf(crawlSite({ ...options, concurrency: invalid })))
          .message,
      ).toContain('concurrency');
      expect(
        (await failureOf(crawlSite({ ...options, maxUrls: invalid }))).message,
      ).toContain('maxUrls');
    },
  );
});

describe('startSiteServer', () => {
  test('a missing working directory rejects the startup promise', async () => {
    const error = await failureOf(
      startSiteServer({
        cwd: join(tmpdir(), `tale-nonexistent-${crypto.randomUUID()}`),
        timeoutMs: 1000,
      }),
    );
    expect(error.message).toContain('ENOENT');
  });

  test('startup diagnostics stay bounded and a hung process is terminated', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tale-crawl-server-'));
    try {
      await writeFile(
        join(directory, 'server.ts'),
        "await Bun.write('pid', String(process.pid)); process.stdout.write('x'.repeat(100_000) + 'startup-tail'); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);\n",
      );
      const error = await failureOf(
        startSiteServer({ cwd: directory, timeoutMs: 500 }),
      );
      expect(error.message).toContain('startup-tail');
      expect(error.message.length).toBeLessThan(66_000);
      const pid = Number(await readFile(join(directory, 'pid'), 'utf8'));
      let alive = true;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        try {
          process.kill(pid, 0);
        } catch {
          alive = false;
          break;
        }
        await Bun.sleep(10);
      }
      expect(alive).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test.each([0, 65_536])(
    'an impossible listening port is refused: %s',
    async (port) => {
      const directory = await mkdtemp(join(tmpdir(), 'tale-crawl-port-'));
      try {
        await writeFile(
          join(directory, 'server.ts'),
          `console.log('listening on :${port}'); setInterval(() => {}, 1000);\n`,
        );
        const error = await failureOf(
          startSiteServer({ cwd: directory, timeoutMs: 1000 }),
        );
        expect(error.message).toContain('invalid listening port');
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  test('a real Bun site announces an ephemeral port and remains usable until stop', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tale-crawl-ready-'));
    let stop: (() => void) | undefined;
    try {
      await writeFile(
        join(directory, 'server.ts'),
        "const site = Bun.serve({ port: Number(process.env.PORT), fetch: () => new Response('ready') }); console.log('listening on :' + site.port);\n",
      );
      const site = await startSiteServer({ cwd: directory, timeoutMs: 1000 });
      stop = site.stop;
      expect(await (await fetch(site.origin)).text()).toBe('ready');
    } finally {
      stop?.();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
