// Paths no file under `dist/` can match, proved against a real Bun server:
// a decoded NUL used to reach `Bun.file`, which throws on it, so the request
// was reported as a server failure and answered 500. Web, docs and ui-docs
// all serve through this code, in both URL-tree shapes.

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

describe('a path carrying a C0 control character', () => {
  it.each(['path', 'none'] as const)(
    "answers the 404 page without reporting a failure (localeRouting: '%s')",
    async (localeRouting) => {
      const app = await start(localeRouting);
      const paths = [
        '/%00',
        '/a%00b',
        '/%00.md',
        '/assets/%00',
        '/%01',
        '/a%1Fb',
      ];
      if (localeRouting === 'path') paths.push('/de/%00', '/fr/a%00b');

      for (const pathname of paths) {
        const response = await get(`${app}${pathname}`);
        expect(response.status, pathname).toBe(404);
        expect(await response.text(), pathname).toContain('not found');
      }
      expect(await reportedCount(app)).toBe(0);

      // The counter is live: a real server failure is still reported.
      expect((await get(`${app}/boom`)).status).toBe(500);
      expect(await reportedCount(app)).toBe(1);
    },
    20000,
  );
});
