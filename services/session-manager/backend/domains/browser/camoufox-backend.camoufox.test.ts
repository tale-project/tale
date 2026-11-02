// The real-browser lane (`bun run test:camoufox`): the backend with the real
// camoufox-js, Playwright and PlaywrightRemote. The browser is reached through
// a local HTTP proxy that serves the test page itself, so nothing leaves the
// host. Needs `CAMOUFOX_INSTALL_DIR` to hold the Camoufox build that
// camoufox-js pins; without it the tests are skipped.

import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Download } from 'playwright-core';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { isRecord } from '../../../lib/is-record.ts';
import type { TabLayout } from '../../lib/web-url.ts';
import { Socks5Proxy } from '../../testing/local-proxies.ts';
import { pageInFront } from '../../testing/real-browser.ts';
import { createIdentity } from '../identity/fingerprints.ts';
import type { GeneratedIdentity } from '../identity/types.ts';
import { CamoufoxBackend } from './camoufox-backend.ts';
import type { CamoufoxDeps, PlaywrightOptions } from './camoufox-backend.ts';
import type { CamoufoxSession } from './camoufox-session.ts';
import { findBrowserPid } from './camoufox-session.ts';
import { isInstalled } from './install.ts';

/** A page through a proxy on this host is there in a moment; a loaded host may take longer. */
const LOAD_TIMEOUT_MS = 20_000;

const configured = process.env.CAMOUFOX_INSTALL_DIR !== undefined;
const ready = configured && isInstalled();

const PAGE = `<!doctype html><meta charset="utf-8"><title>smoke</title>
<body id="out">loading</body>
<script>
  document.getElementById('out').textContent = JSON.stringify({
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    lang: navigator.language,
    screen: [screen.width, screen.height],
  });
</script>`;

/** A file a page offers for download: the browser would save it instead of showing it. */
const ATTACHMENT = '/attachment.bin';
const ATTACHMENT_BYTES = 3_000_000;

/** The files (not the folders) below a directory, with their sizes. */
function filesBelow(directory: string): Array<[string, number]> {
  return readdirSync(directory, { recursive: true, encoding: 'utf8' }).flatMap(
    (name) => {
      const path = join(directory, name);
      const stats = statSync(path);
      return stats.isFile() ? [[name, stats.size] as [string, number]] : [];
    },
  );
}

const ZURICH = {
  ip: '203.0.113.1',
  country: 'CH',
  timezone: 'Europe/Zurich',
  latitude: 47.37,
  longitude: 8.54,
};

/** The Camoufox config that `launchOptions` put into CAMOU_CONFIG_1, CAMOU_CONFIG_2, ... */
function resolvedConfig(options: PlaywrightOptions): Record<string, unknown> {
  const env = options.env;
  if (!isRecord(env)) throw new Error('the options have no environment');
  const chunks = Object.entries(env)
    .filter(([key]) => key.startsWith('CAMOU_CONFIG_'))
    .map(([key, value]) => ({
      index: Number(key.split('_').pop()),
      text: String(value),
    }))
    .sort((a, b) => a.index - b.index);
  const config: unknown = JSON.parse(
    chunks.map((chunk) => chunk.text).join(''),
  );
  if (!isRecord(config)) throw new Error('the Camoufox config is no object');
  return config;
}

/** Without the add-ons: the default one (uBlock Origin) is downloaded when it is missing. */
async function launchOptionsWithoutAddons(
  args: Parameters<CamoufoxDeps['launchOptions']>[0],
): Promise<PlaywrightOptions> {
  const { launchOptions } = await import('camoufox-js');
  return launchOptions({ ...args, exclude_addons: ['UBO'] });
}

describe.skipIf(!ready)('the Camoufox backend with a real browser', () => {
  let server: Server;
  let proxy: { server: string };
  /** What the proxy was asked for: the request line of each request, an absolute address. */
  const asked: string[] = [];
  let identity: GeneratedIdentity;
  const directories: string[] = [];
  const sessions: CamoufoxSession[] = [];
  const backends: CamoufoxBackend[] = [];

  beforeAll(async () => {
    server = createServer((request, response) => {
      // As a proxy it is asked for whatever page the browser wants.
      asked.push(request.url ?? '');
      if (request.url?.endsWith(ATTACHMENT) === true) {
        response.setHeader('content-type', 'application/octet-stream');
        response.setHeader(
          'content-disposition',
          'attachment; filename="attachment.bin"',
        );
        response.end(Buffer.alloc(ATTACHMENT_BYTES, 1));
        return;
      }
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end(PAGE);
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('no port');
    proxy = { server: `http://127.0.0.1:${address.port}` };
    identity = await createIdentity('windows', new Set());
  });

  afterEach(async () => {
    for (const session of sessions.splice(0)) {
      await session.close().catch((error: unknown) => {
        console.warn('could not close a test browser', error);
      });
    }
    for (const backend of backends.splice(0)) await backend.close();
    for (const dir of directories.splice(0))
      rmSync(dir, { recursive: true, force: true });
  });

  afterAll(async () => {
    await new Promise<void>((done) => server.close(() => done()));
  });

  function newBackend(overrides: Partial<CamoufoxDeps> = {}): CamoufoxBackend {
    const backend = new CamoufoxBackend({
      blockWebrtc: false,
      deps: { launchOptions: launchOptionsWithoutAddons, ...overrides },
    });
    backends.push(backend);
    return backend;
  }

  function profile(): string {
    const dir = mkdtempSync(join(tmpdir(), 'sm-camoufox-'));
    directories.push(dir);
    return join(dir, 'profile');
  }

  async function launch(
    backend: CamoufoxBackend,
    profileDir: string,
    extra: { tabs?: TabLayout; onLayout?: (layout: TabLayout) => void } = {},
  ): Promise<CamoufoxSession> {
    const session = await backend.launch({
      profileDir,
      name: 'smoke',
      identity: { ...identity.identity, locale: 'de-CH' },
      proxy,
      location: ZURICH,
      tabs: extra.tabs ?? { urls: [], active: 0 },
      startPage: 'http://smoke.test/',
      onLayout: extra.onLayout,
    });
    sessions.push(session);
    return session;
  }

  async function reading(
    session: CamoufoxSession,
  ): Promise<Record<string, unknown>> {
    let text = '';
    await vi.waitFor(
      async () => {
        text = (await session.remote.readPage()).text;
        expect(text).toContain('"tz"');
      },
      { timeout: LOAD_TIMEOUT_MS },
    );
    const data: unknown = JSON.parse(text);
    if (!isRecord(data)) throw new Error(`the page says ${text}`);
    return data;
  }

  it('resolves to the pinned place of the session, with the proxy of the spec', async () => {
    const seen: PlaywrightOptions[] = [];
    const backend = newBackend({
      launchPersistentContext: async (_dir, options) => {
        seen.push(options);
        throw new Error('stop before the browser starts');
      },
    });
    await expect(
      backend.launch({
        profileDir: profile(),
        name: 'options',
        identity: { ...identity.identity, locale: 'fr-FR' },
        proxy: { server: 'socks5://127.0.0.1:1080' },
        location: { ...ZURICH, ip: '8.8.8.8', timezone: 'America/Los_Angeles' },
        tabs: { urls: [], active: 0 },
        startPage: 'https://www.google.com',
      }),
    ).rejects.toThrow('stop before the browser starts');

    const [options] = seen;
    expect(options?.proxy).toEqual({ server: 'socks5://127.0.0.1:1080' });
    expect(options?.headless).toBe(true);
    const config = resolvedConfig(options ?? {});
    expect(config.timezone).toBe('America/Los_Angeles'); // the session's place, not the host's
    expect([
      config['geolocation:latitude'],
      config['geolocation:longitude'],
    ]).toEqual([ZURICH.latitude, ZURICH.longitude]);
    expect([config['locale:language'], config['locale:region']]).toEqual([
      'fr',
      'FR',
    ]);
    expect(config['webrtc:ipv4']).toBe('8.8.8.8');
    const prefs = options?.firefoxUserPrefs;
    expect(isRecord(prefs) ? prefs : {}).toMatchObject({
      'media.peerconnection.ice.proxy_only': true,
      'browser.startup.couldRestoreSession.count': -1,
      'network.dns.disableIPv6': true,
    });
  });

  it('needs no GeoIP database to know the place of a session', async () => {
    // 203.0.113.1 is a documentation address: no database has a place for it.
    const seen: PlaywrightOptions[] = [];
    const backend = newBackend({
      launchPersistentContext: async (_dir, options) => {
        seen.push(options);
        throw new Error('stop');
      },
    });
    await expect(launch(backend, profile())).rejects.toThrow('stop');
    expect(resolvedConfig(seen[0] ?? {}).timezone).toBe('Europe/Zurich');
  });

  it('launches a browser that says what the identity and the place say', async () => {
    const layouts: TabLayout[] = [];
    const backend = newBackend();
    const session = await launch(backend, profile(), {
      onLayout: (layout) => layouts.push(layout),
    });

    const page = await reading(session);
    expect(page.tz).toBe('Europe/Zurich');
    expect(page.lang).toBe('de-CH');
    const screen = identity.identity.fingerprint.screen;
    expect(page.screen).toEqual([screen.width, screen.height]);
    expect(session.remote.tabs().map((tab) => tab.url)).toEqual([
      'http://smoke.test/',
    ]);
    await vi.waitFor(
      () => expect(layouts.at(-1)?.urls).toEqual(['http://smoke.test/']),
      { timeout: LOAD_TIMEOUT_MS },
    );
  });

  it('saves the open tabs when it closes and reopens them next time', async () => {
    const dir = profile();
    const layouts: TabLayout[] = [];
    const backend = newBackend();
    const first = await launch(backend, dir, {
      onLayout: (layout) => layouts.push(layout),
    });
    await reading(first);
    await first.remote.openTab('http://two.smoke.test/');
    await first.close();
    await first.waitClosed();

    const saved = layouts.at(-1);
    expect(saved?.urls).toEqual([
      'http://smoke.test/',
      'http://two.smoke.test/',
    ]);
    expect(await findBrowserPid(dir)).toBeNull(); // the browser is gone

    const second = await launch(backend, dir, { tabs: saved });
    await vi.waitFor(
      () =>
        expect(second.remote.tabs().map((tab) => tab.url)).toEqual([
          'http://smoke.test/',
          'http://two.smoke.test/',
        ]),
      { timeout: LOAD_TIMEOUT_MS },
    );
  });

  it('ends when the user closes the last tab, and forgets the tabs', async () => {
    const layouts: TabLayout[] = [];
    const session = await launch(newBackend(), profile(), {
      onLayout: (layout) => layouts.push(layout),
    });
    await reading(session);
    for (const tab of session.remote.tabs())
      await session.remote.closeTab(tab.id);

    await session.waitClosed();
    expect(layouts.at(-1)).toEqual({ urls: [], active: 0 });
    await session.close();
    expect(layouts.at(-1)).toEqual({ urls: [], active: 0 }); // not saved again
  });

  it('ends when the browser is killed, and keeps the tabs', async () => {
    const dir = profile();
    const layouts: TabLayout[] = [];
    const session = await launch(newBackend(), dir, {
      onLayout: (layout) => layouts.push(layout),
    });
    await reading(session);
    await vi.waitFor(() => expect(layouts.length).toBeGreaterThan(0), {
      timeout: LOAD_TIMEOUT_MS,
    });

    const pid = await findBrowserPid(dir);
    expect(pid).not.toBeNull();
    process.kill(pid ?? 0, 'SIGKILL');

    await session.waitClosed();
    await session.close(); // a no-op: the browser is gone
    expect(layouts.at(-1)?.urls).toEqual(['http://smoke.test/']);
  });

  it('sends the addresses of this computer through the proxy of the session, never to the computer itself', async () => {
    // A service on this host, reached without the proxy if Firefox goes round
    // it (as it does for localhost, 127.0.0.1 and ::1 by default): the manager's
    // own API is one.
    const reached: string[] = [];
    const service = createServer((request, response) => {
      reached.push(request.url ?? '');
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end('<title>service</title>the service of this computer');
    });
    await new Promise<void>((done) => service.listen(0, '127.0.0.1', done));
    const address = service.address();
    if (address === null || typeof address === 'string') {
      throw new Error('no port');
    }
    try {
      const session = await launch(newBackend(), profile());
      await reading(session);
      asked.length = 0;
      const hosts = ['127.0.0.1', 'localhost', 'sub.localhost', '[::1]'];
      for (const host of hosts) {
        await session.remote.goto(
          `http://${host}:${address.port}/via-${host}`,
          null,
          'load',
        );
      }
      // The proxy got all three, and the service nothing.
      for (const host of hosts) {
        expect(asked).toContain(`http://${host}:${address.port}/via-${host}`);
      }
      expect(reached).toEqual([]);
    } finally {
      service.closeAllConnections();
      await new Promise<void>((done) => service.close(() => done()));
    }
  });

  it('sends the addresses of this computer through a SOCKS5 proxy too', async () => {
    const reached: string[] = [];
    const service = createServer((request, response) => {
      reached.push(request.url ?? '');
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end('<title>service</title>the service of this computer');
    });
    await new Promise<void>((done) => service.listen(0, '127.0.0.1', done));
    const address = service.address();
    if (address === null || typeof address === 'string') {
      throw new Error('no port');
    }
    const socks = await new Socks5Proxy({
      hosts: { 'start.test': '127.0.0.1' },
    }).start();
    try {
      const session = await newBackend().launch({
        profileDir: profile(),
        name: 'socks',
        identity: { ...identity.identity, locale: 'de-CH' },
        proxy: { server: `socks5://127.0.0.1:${socks.port}` },
        location: ZURICH,
        tabs: { urls: [], active: 0 },
        startPage: `http://start.test:${address.port}/start`,
      });
      sessions.push(session);
      await vi.waitFor(() => expect(reached).toContain('/start'), {
        timeout: LOAD_TIMEOUT_MS,
      });
      // Each address in turn: the proxy is asked to connect to the service for
      // it (a browser that went round the proxy would leave it no event), and
      // the service answers through the proxy. The browser may ask for more
      // (an icon, a connection made ahead): it is the presence that counts.
      for (const host of ['127.0.0.1', 'localhost']) {
        socks.clear();
        reached.length = 0;
        await session.remote.goto(
          `http://${host}:${address.port}/via-${host}`,
          null,
          'load',
        );
        expect(
          socks.events.some((event) => event.port === address.port),
          host,
        ).toBe(true);
        expect(reached, host).toContain(`/via-${host}`);
      }
    } finally {
      await socks.stop();
      service.closeAllConnections();
      await new Promise<void>((done) => service.close(() => done()));
    }
  });

  it('refuses a download: nothing is written to the temporary folder, and the session goes on', async () => {
    // Playwright keeps the files of the downloads it accepts in a folder of the
    // temporary directory until the browser closes: a page could fill the disk.
    const temporary = mkdtempSync(join(tmpdir(), 'sm-downloads-'));
    directories.push(temporary);
    const before = process.env.TMPDIR;
    process.env.TMPDIR = temporary;
    try {
      const session = await launch(newBackend(), profile());
      await reading(session);
      const page = pageInFront(session, session.remote.tabs());
      const offered: Download[] = [];
      page.on('download', (download) => offered.push(download));

      await session.remote
        .goto(`http://files.test${ATTACHMENT}`, null, 'load')
        .catch((error: unknown) => {
          // The navigation ends in the download, which is no page.
          console.debug('the download ended the navigation', error);
        });
      await vi.waitFor(() => expect(offered).toHaveLength(1), {
        timeout: LOAD_TIMEOUT_MS,
      });
      // Refused, not saved: it fails, where an accepted one has a path.
      expect(await offered[0]?.failure()).not.toBeNull();
      const kept = filesBelow(temporary).filter(([name]) =>
        name.startsWith('playwright-artifacts-'),
      );
      expect(kept).toEqual([]);

      // The session is where it was.
      await session.remote.goto('http://smoke.test/', null, 'load');
      expect((await reading(session)).tz).toBe('Europe/Zurich');
    } finally {
      if (before === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = before;
    }
  });

  it('kills a browser that does not answer when it is asked to close', async () => {
    const dir = profile();
    const session = await launch(newBackend(), dir);
    await reading(session);

    const pid = await findBrowserPid(dir);
    expect(pid).not.toBeNull();
    process.kill(pid ?? 0, 'SIGSTOP'); // it hears nothing now
    try {
      await session.close(2_000);
    } finally {
      try {
        process.kill(pid ?? 0, 'SIGKILL');
      } catch (error) {
        // Gone already: the kill of the session worked.
        console.debug('the stopped browser is gone', error);
      }
    }
    expect(await findBrowserPid(dir)).toBeNull();
  });
});
