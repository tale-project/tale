import { Database } from 'bun:sqlite';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { loadConfig } from './config.ts';
import { StoreOpenError } from './db/store.ts';
import { startServer, type RunningServer } from './main.ts';
import { FakeBackend } from './testing/fake-browser.ts';
import { FakeExitIpChecker } from './testing/fake-exit-ip.ts';

let directory: string;
let running: RunningServer | undefined;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'session-manager-main-'));
  mkdirSync(join(directory, 'dist'));
  writeFileSync(
    join(directory, 'dist', 'index.html'),
    '<!doctype html><title>shell</title>',
  );
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await running?.stop();
  running = undefined;
  rmSync(directory, { recursive: true, force: true });
});

/** A port nothing listens on, which the allowed hosts can be named after. */
async function freePort(): Promise<number> {
  const probe = Bun.serve({ port: 0, fetch: () => new Response() });
  const { port } = probe;
  await probe.stop(true);
  if (port === undefined) throw new Error('the probe has no port');
  return port;
}

async function start(environment: Record<string, string> = {}) {
  const port = await freePort();
  const config = loadConfig(
    {
      PORT: String(port),
      SESSION_MANAGER_DATA_DIR: join(directory, 'data'),
      ...environment,
    },
    { distDir: join(directory, 'dist') },
  );
  const backend = new FakeBackend();
  const checker = new FakeExitIpChecker();
  running = startServer(config, { backend, checker });
  return { origin: `http://127.0.0.1:${port}`, port, backend, checker };
}

/** `fetch` cannot lie about its Host header; a program can. */
function getWithHost(
  port: number,
  path: string,
  host: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, path, headers: { Host: host, ...headers } },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => (body += chunk));
        response.on('end', () => {
          resolve({ status: response.statusCode ?? 0, body });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('the server', () => {
  it('answers its health route and serves the page for every address of the app', async () => {
    const { origin } = await start();

    const health = await fetch(`${origin}/api/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: 'ok' });

    // A route of the single-page app is the page, whatever its depth.
    for (const path of ['/', '/sessions/12', '/settings/ai-access']) {
      const page = await fetch(`${origin}${path}`);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('<title>shell</title>');
    }
  });

  it('tells a supervisor it is shutting down once the marker file exists', async () => {
    const marker = join(directory, 'draining');
    const { origin } = await start({ SHUTDOWN_MARKER_PATH: marker });
    expect((await fetch(`${origin}/api/health`)).status).toBe(200);

    writeFileSync(marker, '');

    const health = await fetch(`${origin}/api/health`);
    expect(health.status).toBe(503);
    expect(await health.json()).toEqual({ status: 'shutting_down' });
  });

  it('answers the API through the backend and keeps its refusals', async () => {
    const { origin } = await start();

    const meta = await fetch(`${origin}/api/meta`);
    expect(meta.status).toBe(200);
    expect(await meta.json()).toMatchObject({
      browserInstalled: true,
      counts: { sessions: 0 },
    });

    const unknown = await fetch(`${origin}/api/nope`);
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: 'not_found' });

    // A foreign site's form post: refused before it is read.
    const foreign = await fetch(`${origin}/api/proxies`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://evil.example',
      },
      body: JSON.stringify({ proxy: '1.2.3.4:80' }),
    });
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toMatchObject({ error: 'forbidden_origin' });
  });

  it('keeps a page of another site from fetching the data of the app, and still lets its link open the page', async () => {
    const { origin } = await start();
    // What a browser sends for a page of another site that navigates to the
    // export of the proxy passwords (it would save the file to Downloads).
    const crossSite = {
      'Sec-Fetch-Site': 'cross-site',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Dest': 'document',
    };
    for (const path of [
      '/api/sessions/export-proxies',
      '/api/meta',
      '/api/nope',
      '/mcp',
    ]) {
      const refused = await fetch(`${origin}${path}`, { headers: crossSite });
      expect(refused.status, path).toBe(403);
      expect(await refused.json()).toMatchObject({ error: 'forbidden_origin' });
    }
    // The page itself, opened by a link on another site, is served.
    const page = await fetch(`${origin}/`, { headers: crossSite });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<title>shell</title>');
    // The page's own request, and the person's, are not refused.
    for (const site of ['same-origin', 'none']) {
      const own = await fetch(`${origin}/api/meta`, {
        headers: { 'Sec-Fetch-Site': site },
      });
      expect(own.status, site).toBe(200);
    }
  });

  it('refuses a request that addresses it by another host name, page and API alike', async () => {
    const { port } = await start();
    for (const path of ['/', '/sessions/1', '/api/meta', '/mcp']) {
      const answer = await getWithHost(port, path, 'rebind.example');
      expect(answer.status).toBe(403);
      expect(JSON.parse(answer.body)).toMatchObject({
        error: 'forbidden_host',
      });
    }
    // The operator's own names are allowed on top.
    expect(
      (await getWithHost(port, '/api/meta', `localhost:${port}`)).status,
    ).toBe(200);
  });

  it('refuses a live view handshake by the host it fails first: the name of the host, then the site', async () => {
    const { port } = await start();
    const handshake = {
      Upgrade: 'websocket',
      Connection: 'Upgrade',
      'Sec-WebSocket-Version': '13',
      'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
    };
    const path = '/api/sessions/1/stream';
    const rebinding = await getWithHost(port, path, 'rebind.example', {
      ...handshake,
      Origin: 'http://rebind.example',
    });
    expect(rebinding.status).toBe(403);
    expect(JSON.parse(rebinding.body)).toMatchObject({
      error: 'forbidden_host',
    });

    const foreign = await getWithHost(port, path, `127.0.0.1:${port}`, {
      ...handshake,
      Origin: 'http://evil.example',
    });
    expect(foreign.status).toBe(403);
    expect(JSON.parse(foreign.body)).toMatchObject({
      error: 'forbidden_origin',
    });

    const crossSite = await getWithHost(port, path, `127.0.0.1:${port}`, {
      ...handshake,
      'Sec-Fetch-Site': 'cross-site',
    });
    expect(crossSite.status).toBe(403);
    expect(JSON.parse(crossSite.body)).toMatchObject({
      error: 'forbidden_origin',
    });
  });

  it('opens the live view of a session and tells a session that is not there', async () => {
    const { port } = await start();
    const socket = new WebSocket(
      `ws://127.0.0.1:${port}/api/sessions/404/stream`,
    );
    const first = await new Promise<string>((resolve, reject) => {
      socket.addEventListener('message', (event) => {
        resolve(String(event.data));
      });
      socket.addEventListener('error', () => {
        reject(new Error('the socket failed'));
      });
    });
    expect(JSON.parse(first)).toMatchObject({
      t: 'error',
      code: 'session_not_found',
    });
    socket.close();
  });

  it('keeps the MCP endpoint shut until the person switches AI access on', async () => {
    const { origin } = await start();
    const call = () =>
      fetch(`${origin}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'test', version: '0' },
          },
        }),
      });

    const closed = await call();
    expect(closed.status).toBe(403);
    expect(await closed.json()).toMatchObject({ error: 'ai_access_off' });

    const switched = await fetch(`${origin}/api/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mcpEnabled: true }),
    });
    expect(switched.status).toBe(200);

    const open = await call();
    expect(open.status).toBe(200);
    expect(await open.json()).toMatchObject({
      result: { serverInfo: { name: 'session-manager' } },
    });
  });

  it('keeps the data private to its user and uses the fakes it was given', async () => {
    const { backend } = await start();
    // The browser was warmed up while the page already answered.
    await expect.poll(() => backend.warmUps).toBeGreaterThan(0);
  });

  it('stops: the port is released and the browsers are closed', async () => {
    const { origin } = await start();
    await running?.stop();
    running = undefined;
    await expect(fetch(`${origin}/api/health`)).rejects.toThrow();
  });

  it('stops while a live view is open: the browser closes first, then the socket', async () => {
    // Bun's `server.stop()` waits for every open socket: a page that shows a
    // session must not keep SIGTERM from closing the browsers (and saving
    // their tabs), or `docker stop` ends in SIGKILL.
    const { origin, port, backend } = await start();
    const post = (path: string, body: unknown) =>
      fetch(`${origin}/api${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    await post('/proxies/import', { text: '203.0.113.9:8080' });
    const created = await post('/sessions', { name: 'live', os: 'random' });
    const { id } = z.object({ id: z.number() }).parse(await created.json());
    await expect
      .poll(async () => {
        const answer = await fetch(`${origin}/api/sessions/${id}`);
        return z.object({ status: z.string() }).parse(await answer.json())
          .status;
      })
      .toBe('running');

    const socket = new WebSocket(
      `ws://127.0.0.1:${port}/api/sessions/${id}/stream`,
    );
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('message', () => resolve(), { once: true });
      socket.addEventListener('error', () => reject(new Error('socket')), {
        once: true,
      });
    });
    const closed = new Promise<void>((resolve) => {
      socket.addEventListener('close', () => resolve(), { once: true });
    });

    const stopping = running?.stop();
    running = undefined;
    const outcome = await Promise.race([
      stopping?.then(() => 'stopped'),
      new Promise<string>((resolve) => setTimeout(() => resolve('hung'), 3000)),
    ]);

    expect(outcome).toBe('stopped');
    await closed;
    expect(backend.launches[0]?.closed).toBe(true);
  });
});

describe('the analytics of the shared server', () => {
  // `startReactServer` turns a Umami proxy on when these are in the
  // environment (the platform's development shell has them). The manager has no
  // visitors to count, and must not send anything anywhere because of them.
  const WEBSITE = '3f0c5a52-9a53-4d3a-9c0e-2f6d1b8a7e41';
  const TOKEN = 'a-proxy-token-of-16-chars-or-more';

  it('stay off when the environment has the variables that would turn them on', async () => {
    const collected: string[] = [];
    const collector = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch(request) {
        collected.push(`${request.method} ${new URL(request.url).pathname}`);
        return new Response('/* the tracker */', {
          headers: { 'content-type': 'application/javascript' },
        });
      },
    });
    try {
      vi.stubEnv('UMAMI_WEBSITE_ID', WEBSITE);
      vi.stubEnv('UMAMI_URL', `http://127.0.0.1:${collector.port}`);
      vi.stubEnv('UMAMI_PROXY_TOKEN', TOKEN);
      const { origin } = await start();

      // The route of the tracker is no route here, and the page does not load it.
      const script = await fetch(`${origin}/_a/script.js`);
      expect(script.status).not.toBe(200);
      expect(await script.text()).not.toContain('the tracker');
      const event = await fetch(`${origin}/_a/api/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      expect(event.status).not.toBe(200);
      const page = await (await fetch(`${origin}/`)).text();
      expect(page).not.toContain('tale-analytics');
      expect(page).not.toContain(WEBSITE);
      expect(collected).toEqual([]);
    } finally {
      await collector.stop(true);
    }
  });
});

describe('a port that is taken', () => {
  it('refuses to start and closes what it had opened', async () => {
    const taken = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: () => new Response('taken'),
    });
    try {
      const backend = new FakeBackend();
      const config = loadConfig(
        {
          PORT: String(taken.port),
          SESSION_MANAGER_DATA_DIR: join(directory, 'data'),
        },
        { distDir: join(directory, 'dist') },
      );
      expect(() =>
        startServer(config, { backend, checker: new FakeExitIpChecker() }),
      ).toThrow();
      // The browsers, the background work and the database are closed, not
      // left to the process's end (a launcher or a test starts several).
      await expect.poll(() => backend.closeCalls).toBeGreaterThan(0);
    } finally {
      await taken.stop(true);
    }
  });
});

describe("a data directory that holds another program's database", () => {
  it('refuses to start and leaves the file as it was', async () => {
    const data = join(directory, 'data');
    mkdirSync(data, { recursive: true });
    const file = join(data, 'manager.db');
    const foreign = new Database(file);
    foreign.run(
      'CREATE TABLE sessions (id INTEGER PRIMARY KEY, identity TEXT)',
    );
    foreign.run('PRAGMA user_version = 4');
    foreign.close();
    const before = await Bun.file(file).bytes();

    const port = await freePort();
    const config = loadConfig(
      { PORT: String(port), SESSION_MANAGER_DATA_DIR: data },
      { distDir: join(directory, 'dist') },
    );
    expect(() =>
      startServer(config, {
        backend: new FakeBackend(),
        checker: new FakeExitIpChecker(),
      }),
    ).toThrow(StoreOpenError);

    expect(await Bun.file(file).bytes()).toEqual(before);
  });

  it('leaves the directory as it was too: no folder made in it, its mode not changed', async () => {
    const data = join(directory, 'data');
    mkdirSync(data, { recursive: true, mode: 0o755 });
    chmodSync(data, 0o755);
    const file = join(data, 'manager.db');
    const foreign = new Database(file);
    foreign.run('CREATE TABLE other (id INTEGER PRIMARY KEY)');
    foreign.close();
    chmodSync(file, 0o644);
    const before = readdirSync(data).sort();

    const port = await freePort();
    const config = loadConfig(
      { PORT: String(port), SESSION_MANAGER_DATA_DIR: data },
      { distDir: join(directory, 'dist') },
    );
    expect(() =>
      startServer(config, {
        backend: new FakeBackend(),
        checker: new FakeExitIpChecker(),
      }),
    ).toThrow(StoreOpenError);

    expect(readdirSync(data).sort()).toEqual(before);
    expect(statSync(data).mode & 0o777).toBe(0o755);
    expect(statSync(file).mode & 0o777).toBe(0o644);
  });

  it('makes the directory private when it starts', async () => {
    const data = join(directory, 'data');
    mkdirSync(data, { recursive: true, mode: 0o755 });
    chmodSync(data, 0o755);
    await start({ SESSION_MANAGER_DATA_DIR: data });
    expect(statSync(data).mode & 0o777).toBe(0o700);
    expect(statSync(join(data, 'manager.db')).mode & 0o777).toBe(0o600);
    expect(statSync(join(data, 'profiles')).isDirectory()).toBe(true);
  });
});
