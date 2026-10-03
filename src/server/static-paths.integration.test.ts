// Paths no file under `dist/` can carry, proved against a real Bun server.
// `Bun.file` throws, where `exists()` would answer false, for a name holding
// a NUL and for one of PATH_MAX bytes or more (1024 on macOS, 4096 on Linux).
// Either used to reach `Bun.serve`'s `error()`, so the request was reported
// as a server failure and answered 500. Web, docs, ui-docs and ai-gateway all
// serve through this code, in both URL-tree shapes.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bunServers, serverModule } from '@/tests/utils/site-server';

const servers = bunServers();
let directory: string;

/**
 * Boots a server over a one-page `dist/` with a 404. `reportError` counts
 * into `/reported`; `/boom` throws, so a test can prove the counter is live.
 */
async function start(localeRouting: 'path' | 'none'): Promise<string> {
  const [app] = await servers.start(`
import { startReactServer } from ${JSON.stringify(serverModule)};
let reported = 0;
const server = startReactServer({
  port: 0,
  hostname: '127.0.0.1',
  distDir: ${JSON.stringify(directory)},
  logPrefix: 'static-paths-test',
  localeRouting: ${JSON.stringify(localeRouting)},
  reportError: () => { reported += 1; },
  extraRoutes(request, url) {
    if (url.pathname === '/reported') return Response.json({ reported });
    if (url.pathname === '/boom') throw new Error('boom');
    return null;
  },
});
console.log('READY ' + server.port);
`);
  return app;
}

/**
 * A request path whose file under `dist/` has a path `length` bytes long,
 * made of one-letter directories.
 */
function resolvingTo(length: number): string {
  const rel = length - directory.length - 1;
  return `/${'a/'.repeat(rel).slice(0, rel - 1)}z`;
}

function get(url: string) {
  return fetch(url, {
    headers: { 'Accept-Language': 'en' },
    redirect: 'manual',
    signal: AbortSignal.timeout(5000),
  });
}

async function reportedCount(app: string): Promise<number> {
  const body = (await (await get(`${app}/reported`)).json()) as {
    reported: number;
  };
  return body.reported;
}

beforeAll(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'tale-static-paths-'));
  writeFileSync(path.join(directory, 'index.html'), '<!doctype html>home');
  mkdirSync(path.join(directory, '404'));
  writeFileSync(
    path.join(directory, '404', 'index.html'),
    '<!doctype html>not found',
  );
});
afterAll(() => {
  servers.stop();
  rmSync(directory, { recursive: true, force: true });
});

describe('a path no file under dist/ can carry', () => {
  it.each(['path', 'none'] as const)(
    "answers the 404 page without reporting a failure (localeRouting: '%s')",
    async (localeRouting) => {
      const app = await start(localeRouting);
      const paths = [
        // A NUL: Bun refuses the name before it asks the filesystem.
        '/%00',
        '/a%00b',
        '/%00.md',
        '/assets/%00',
        // Past PATH_MAX on either platform: the file probe is refused.
        `/${'a'.repeat(5000)}`,
        // Just under PATH_MAX (macOS, then Linux): the file probe misses, and
        // the `index.html` probe beside it is the one refused.
        resolvingTo(1024 - 5),
        resolvingTo(4096 - 5),
        // Another C0 control. Bun asks the filesystem, which just misses, so
        // these answered 404 before the C0 guard as well: they pin the answer,
        // not the guard. Only the NUL and over-long paths above ever
        // answered 500; the guard refuses the rest of C0 to match the
        // platform's `nulUrlGuard`.
        '/%01',
        '/a%1Fb',
      ];
      if (localeRouting === 'path') paths.push('/de/%00', '/fr/a%00b');

      for (const pathname of paths) {
        const label =
          pathname.length > 40
            ? `${pathname.slice(0, 12)}… (${pathname.length} chars)`
            : pathname;
        const response = await get(`${app}${pathname}`);
        expect(response.status, label).toBe(404);
        expect(await response.text(), label).toContain('not found');
      }
      expect(await reportedCount(app)).toBe(0);

      // The counter is live: a real server failure is still reported.
      expect((await get(`${app}/boom`)).status).toBe(500);
      expect(await reportedCount(app)).toBe(1);
    },
    20000,
  );
});
