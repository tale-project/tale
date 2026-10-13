// `resolveNotFound`, proved against a real Bun server: an address that names
// no page or file reaches the resolver, which can answer a redirect or let
// the 404 page answer; a page, a file or a malformed path never reaches it.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bunServers, serverModule } from '@/tests/utils/site-server';

const servers = bunServers();
let directory: string;

/** A server whose resolver sends `/guess` to `/docs`, marks every other
 *  miss it sees with a 418, and leaves `/unknown` to the 404 page. */
async function start(): Promise<string> {
  const [app] = await servers.start(`
import { startReactServer } from ${JSON.stringify(serverModule)};
const server = startReactServer({
  port: 0,
  hostname: '127.0.0.1',
  distDir: ${JSON.stringify(directory)},
  logPrefix: 'resolve-not-found-test',
  localeRouting: 'none',
  resolveNotFound: (request, url) => {
    if (url.pathname === '/unknown') return null;
    if (url.pathname === '/guess') {
      return new Response(null, { status: 302, headers: { Location: '/docs' } });
    }
    return new Response(request.method + ' ' + url.pathname, { status: 418 });
  },
});
console.log('READY ' + server.port);
`);
  return app;
}

function get(url: string) {
  return fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
}

beforeAll(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'tale-resolve-not-found-'));
  writeFileSync(path.join(directory, 'index.html'), '<!doctype html>home');
  for (const route of ['docs', '404']) {
    mkdirSync(path.join(directory, route));
    writeFileSync(
      path.join(directory, route, 'index.html'),
      `<!doctype html>${route}`,
    );
  }
  mkdirSync(path.join(directory, 'assets'));
  writeFileSync(path.join(directory, 'assets', 'app.js'), 'export {};');
});
afterAll(() => {
  servers.stop();
  rmSync(directory, { recursive: true, force: true });
});

describe('resolveNotFound', () => {
  it('answers a miss with the redirect it returns', async () => {
    const app = await start();
    const guess = await get(`${app}/guess`);
    expect(guess.status).toBe(302);
    expect(guess.headers.get('location')).toBe('/docs');
  }, 20000);

  it('falls through to the 404 page when it returns null', async () => {
    const app = await start();
    const unknown = await get(`${app}/unknown`);
    expect(unknown.status).toBe(404);
    expect(await unknown.text()).toContain('404');
  }, 20000);

  it('is never consulted for a page, a file or a malformed path', async () => {
    const app = await start();
    expect((await get(`${app}/docs`)).status).toBe(200);
    expect((await get(`${app}/assets/app.js`)).status).toBe(200);
    expect((await get(`${app}/%E0%A4%A`)).status).toBe(404);
    // A miss it is consulted for: the resolver sees the request itself.
    const missing = await get(`${app}/assets/missing.js`);
    expect(missing.status).toBe(418);
    expect(await missing.text()).toBe('GET /assets/missing.js');
  }, 20000);
});
