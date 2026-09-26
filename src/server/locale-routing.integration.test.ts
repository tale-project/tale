// The two URL-tree shapes `startReactServer` serves, proved against a real
// Bun server. `path` is what web and docs ship (English canonical, `/de` and
// `/fr` trees); `none` is a single untranslated tree (ui-docs), where
// negotiating a reader into `/de` would hand them a 404 for a page the site
// never had.

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const serverModule = path.resolve('src/server/index.ts');
const children: ChildProcess[] = [];
let directory: string;

/** Boots a server over a two-page `dist/` (`/` and `/docs/`) and a 404. */
async function start(localeRouting: 'path' | 'none'): Promise<string> {
  const script = `
import { startReactServer } from ${JSON.stringify(serverModule)};
const server = startReactServer({
  port: 0,
  hostname: '127.0.0.1',
  distDir: ${JSON.stringify(directory)},
  logPrefix: 'locale-routing-test',
  localeRouting: ${JSON.stringify(localeRouting)},
});
console.log('READY ' + server.port);
`;
  const child = spawn('bun', ['--eval', script], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  return new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(
      () => reject(new Error(`Bun server did not start: ${output}`)),
      20_000,
    );
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      const match = /READY (\d+)/.exec(output);
      if (match) {
        clearTimeout(timeout);
        resolve(`http://127.0.0.1:${match[1]}`);
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Bun exited ${code}: ${output}`));
    });
  });
}

function get(url: string, headers: Record<string, string> = {}) {
  return fetch(url, {
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(5000),
  });
}

beforeAll(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'tale-locale-routing-'));
  writeFileSync(path.join(directory, 'index.html'), '<!doctype html>home');
  for (const route of ['docs', '404']) {
    mkdirSync(path.join(directory, route));
    writeFileSync(
      path.join(directory, route, 'index.html'),
      `<!doctype html>${route}`,
    );
  }
});
afterAll(() => {
  for (const child of children) child.kill();
  rmSync(directory, { recursive: true, force: true });
});

describe("localeRouting: 'path' — a translated site", () => {
  it('sends a German reader into the German tree and remembers the choice', async () => {
    const app = await start('path');

    const detected = await get(`${app}/`, { 'Accept-Language': 'de-CH,de' });
    expect(detected.status).toBe(302);
    expect(detected.headers.get('location')).toBe('/de');
    expect(detected.headers.get('set-cookie')).toContain('tale_locale=de');

    const remembered = await get(`${app}/docs`, { Cookie: 'tale_locale=fr' });
    expect(remembered.status).toBe(302);
    expect(remembered.headers.get('location')).toBe('/fr/docs');

    const english = await get(`${app}/`, { 'Accept-Language': 'en-GB,en' });
    expect(english.status).toBe(200);
    expect(english.headers.get('vary')).toContain('Accept-Language');
  }, 20000);
});

describe("localeRouting: 'none' — one untranslated tree", () => {
  it('answers the page itself whatever language the reader asks for', async () => {
    const app = await start('none');

    for (const acceptLanguage of [
      'de-CH,de;q=0.9,en;q=0.8',
      'fr-FR,fr',
      'en',
    ]) {
      const page = await get(`${app}/`, { 'Accept-Language': acceptLanguage });
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('home');
    }

    // A `tale_locale` cookie is shared across tale.dev's sites; it must not
    // move a reader off a site that has no other tree to move them to.
    const withCookie = await get(`${app}/docs`, { Cookie: 'tale_locale=de' });
    expect(withCookie.status).toBe(200);
  }, 20000);

  it('writes no locale cookie and does not vary on the locale headers', async () => {
    const app = await start('none');
    const page = await get(`${app}/`, { 'Accept-Language': 'de' });
    expect(page.headers.get('set-cookie')).toBeNull();
    expect(page.headers.get('vary')).toBeNull();
  }, 20000);

  it('sends a stale locale-prefixed URL home instead of 404ing it', async () => {
    const app = await start('none');

    const root = await get(`${app}/de`);
    expect(root.status).toBe(301);
    expect(root.headers.get('location')).toBe('/');

    const page = await get(`${app}/fr/docs?q=button`);
    expect(page.status).toBe(301);
    expect(page.headers.get('location')).toBe('/docs?q=button');
  }, 20000);

  it('still answers 404 for a path that is genuinely unknown', async () => {
    const app = await start('none');
    const missing = await get(`${app}/nope`);
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain('404');
  }, 20000);
});
