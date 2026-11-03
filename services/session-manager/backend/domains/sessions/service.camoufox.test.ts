// The real-browser lane (`bun run test:camoufox`), service level: the manager
// with the real `CamoufoxBackend` and a real Camoufox, over local proxies and
// local pages (nothing leaves the host). What is real: the identities, the
// GeoIP database, the credential bridge, the profile directories and the
// browser. What is faked is the exit-IP check: each proxy exits through the
// address the test says (one the offline GeoIP database knows).
//
// The unit-level tests of the browser (`playwright-remote.camoufox.test.ts`,
// `camoufox-backend.camoufox.test.ts`, `fingerprints.camoufox.test.ts`) show
// that the pieces do what they promise; these show that the manager puts them
// together right: traffic, isolation, identity, place, tabs, crashes, rotation.
//
// Three tests guard what this Camoufox build gets wrong on its own (a page never
// gets the coordinates of the exit IP; a profile keeps the time zone of its first
// launch): `camoufox-backend.ts` works around both, and each test says how.
//
// Needs `CAMOUFOX_INSTALL_DIR` to hold the Camoufox build (and the GeoIP
// database); without it the tests are skipped. A browser takes a few seconds to
// start, so a describe shares the sessions its tests look at.

import { existsSync } from 'node:fs';
import net from 'node:net';
import { networkInterfaces } from 'node:os';
import { basename } from 'node:path';

import type { Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { Session } from '../../../lib/api/schemas.ts';
import { waitFor } from '../../testing/harness.ts';
import { HttpProxy, Socks5Proxy } from '../../testing/local-proxies.ts';
import {
  REAL_BROWSER_READY,
  browserProcesses,
  filesContaining,
  processTable,
} from '../../testing/real-browser.ts';
import {
  EXIT,
  SITE_HOST,
  SITE_HOSTS,
  STOP_TIMEOUT_MS,
  activePage,
  createRealManager,
  exitThrough,
  resume,
  routeThrough,
  startSession,
  stopSession,
  storedLayout,
  untilRunning,
  untilTabs,
  visit,
} from '../../testing/real-manager.ts';
import type {
  ExitPoint,
  RealManager,
  RealManagerOptions,
} from '../../testing/real-manager.ts';
import { readOut, startSite } from '../../testing/real-pages.ts';
import type { Site } from '../../testing/real-pages.ts';
import { runProbe, startTestPages } from '../../testing/test-pages.ts';
import type { TestPages } from '../../testing/test-pages.ts';
import { findBrowserPid } from '../browser/camoufox-session.ts';
import { lookup } from '../identity/geo.ts';

/** One test: a few page loads and a restart or two. */
const TIMEOUT_MS = 90_000;
/** The sessions a describe starts for its tests. */
const SETUP_TIMEOUT_MS = 180_000;
const POLL = { timeout: 30_000, interval: 50 };

type AnyProxy = HttpProxy | Socks5Proxy;

// -- what pages and the clock say ------------------------------------------------------------

/** What `/where.html` found out. */
const whereSchema = z.object({
  timeZone: z.string(),
  january: z.number(),
  july: z.number(),
  dateString: z.string(),
  language: z.string(),
  languages: z.array(z.string()),
  secure: z.boolean(),
});

/** What `/position.html` was given. */
const positionSchema = z.object({
  secure: z.boolean(),
  permission: z.string(),
  position: z.union([
    z.object({ lat: z.number(), lon: z.number(), accuracy: z.number() }),
    z.object({ error: z.string() }),
  ]),
});

/** What `/webrtc.html` was offered. */
const webrtcSchema = z.object({
  available: z.boolean(),
  candidates: z.array(z.string()),
  sdp: z.string(),
  error: z.string().nullable(),
});

/** The minutes that `Date#getTimezoneOffset` gives in a zone at a moment (UTC minus local time). */
function offsetOf(zone: string, at: Date): number {
  const text =
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      timeZoneName: 'longOffset',
    })
      .formatToParts(at)
      .find((part) => part.type === 'timeZoneName')?.value ?? '';
  const match = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/u.exec(text);
  if (match === null)
    throw new Error(`cannot read the offset ${text} of ${zone}`);
  const east =
    match[1] === undefined
      ? 0
      : (match[1] === '-' ? -1 : 1) *
        (Number(match[2]) * 60 + Number(match[3]));
  return -east;
}

/** How `Date#toString` writes a getTimezoneOffset: `GMT+0100`. */
function gmtOf(offset: number): string {
  const east = -offset;
  const minutes = Math.abs(east);
  const hh = String(Math.trunc(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return `GMT${east < 0 ? '-' : '+'}${hh}${mm}`;
}

const JANUARY = new Date(Date.UTC(2024, 0, 1, 12));
const JULY = new Date(Date.UTC(2024, 6, 1, 12));
const SAMPLE = new Date(Date.UTC(2024, 0, 2, 3, 4, 5));

/** The address and type of an ICE candidate line: `candidate:0 1 UDP 2122252543 <address> 59055 typ host`. */
function candidateOf(line: string): { address: string; type: string } {
  const parts = line.split(' ');
  return {
    address: parts[4] ?? '',
    type: parts[parts.indexOf('typ') + 1] ?? '',
  };
}

/** Every address of this host's network interfaces. */
function ownAddresses(): Set<string> {
  return new Set(
    Object.values(networkInterfaces())
      .flatMap((list) => list ?? [])
      .map((entry) => entry.address),
  );
}

/** The zone this host is in: a session there looks like the host. */
const HOST_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * The exit points of which the GeoIP database says a zone other than the one
 * this host is in: a browser that ignores the zone it was configured with
 * would show the host's, and a test must tell that from the zone it asked for.
 */
async function awayFromHere(
  candidates: readonly ExitPoint[],
): Promise<ExitPoint[]> {
  const away: ExitPoint[] = [];
  for (const exit of candidates) {
    if ((await lookup(exit.ip)).timezone !== HOST_ZONE) away.push(exit);
  }
  return away;
}

/** Does something listen on this port of the loopback address? */
function listening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      resolve(false);
    });
  });
}

// -- what the tests set up ---------------------------------------------------------------

/** The apps and proxies a describe made: closed in that order after it (browsers first). */
class Scope {
  readonly #apps: RealManager[] = [];
  readonly #proxies: AnyProxy[] = [];

  app(options: RealManagerOptions = {}): RealManager {
    const app = createRealManager(options);
    this.#apps.push(app);
    return app;
  }

  async proxy(
    options: {
      socks?: boolean;
      username?: string;
      password?: string;
      port?: number;
    } = {},
  ): Promise<AnyProxy> {
    const { socks, ...credentials } = options;
    const proxy = socks
      ? new Socks5Proxy({ hosts: SITE_HOSTS, ...credentials })
      : new HttpProxy({ hosts: SITE_HOSTS, ...credentials });
    await proxy.start();
    this.#proxies.push(proxy);
    return proxy;
  }

  async close(): Promise<void> {
    for (const app of this.#apps.splice(0)) await app.close();
    for (const proxy of this.#proxies.splice(0)) await proxy.stop();
  }
}

describe.skipIf(!REAL_BROWSER_READY)('the manager with a real browser', () => {
  let pages: TestPages;
  let site: Site;

  /** An address of this lane's pages under the host name the test proxies route. */
  const onSite = (path: string): string => site.url(path, SITE_HOST);
  /** The same pages by their loopback address: also sent through the proxy of the session, and a secure context. */
  const onLoopback = (path: string): string => site.url(path);

  beforeAll(async () => {
    pages = await startTestPages();
    site = await startSite();
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await site?.close();
    await pages?.close();
    // Every describe closed its browsers: none of this run's is left, not even
    // one that lost its parent. A straggler is killed (it is ours) and reported.
    let left = await browserProcesses();
    for (let wait = 0; wait < 100 && left.length > 0; wait++) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 100);
      });
      left = await browserProcesses();
    }
    for (const row of left) process.kill(row.pid, 'SIGKILL');
    expect(left.map((row) => row.command)).toEqual([]);
  }, SETUP_TIMEOUT_MS);

  /** A manager whose new sessions open `/storage.html` of the site. */
  function appFor(scope: Scope, options: RealManagerOptions = {}): RealManager {
    const app = scope.app(options);
    app.manager.updateSettings({ startPage: onSite('/storage.html') });
    return app;
  }

  // -- 1. every request goes through the proxy ---------------------------------------------

  describe('the traffic of a session', () => {
    const scope = new Scope();
    let app: RealManager;
    let httpProxy: AnyProxy;
    let socksProxy: AnyProxy;
    let withHttp: Session;
    let withSocks: Session;

    /** The requests of a page visit, as the site and the proxy each saw them. */
    const atSite = (tag: string): string[] =>
      site.requests
        .filter((request) => request.path.includes(`via=${tag}`))
        .map((request) => request.path)
        .sort();

    beforeAll(async () => {
      // For a browser that does not use its proxy the site's name resolves to
      // this host: a request that went around the proxy would be answered by
      // the site, and counted there.
      app = appFor(scope, {
        prefs: { 'network.dns.localDomains': SITE_HOST },
      });
      httpProxy = await scope.proxy({
        username: 'alice',
        password: 's3cr#t:@x',
      });
      socksProxy = await scope.proxy({
        socks: true,
        username: 'sockuser',
        password: 'sock:pw',
      });
      await routeThrough(app, httpProxy, EXIT.chicago);
      app.manager.updateSettings({
        startPage: onSite('/storage.html?via=http'),
      });
      withHttp = await startSession(app, 'http');
      await routeThrough(app, socksProxy, EXIT.zurich);
      app.manager.updateSettings({
        startPage: onSite('/storage.html?via=socks'),
      });
      withSocks = await startSession(app, 'socks');
    }, SETUP_TIMEOUT_MS);

    afterAll(() => scope.close());

    async function loadAssets(session: Session, tag: string): Promise<Page> {
      const page = await visit(
        app,
        session.id,
        onSite(`/assets.html?via=${tag}`),
      );
      await page.waitForSelector('body[data-script="ran"][data-fetched]', {
        state: 'attached',
        timeout: POLL.timeout,
      });
      return page;
    }

    it(
      'sends a page and all it loads through an HTTP proxy, which gets the credentials from the bridge',
      async () => {
        await untilTabs(app, withHttp.id, [onSite('/storage.html?via=http')]);
        await loadAssets(withHttp, 'http');

        const wanted = [
          '/assets.html?via=http',
          '/p/app.js?via=http',
          '/p/data.json?via=http',
          '/storage.html?via=http',
        ];
        // What the proxy carried is what the site got: nothing went around it.
        expect(atSite('http')).toEqual(wanted);
        const carried = httpProxy.events
          .filter((event) => event.host === SITE_HOST)
          .map((event) => new URL(event.target))
          .map((url) => `${url.pathname}${url.search}`)
          .filter((path) => path.includes('via=http'))
          .sort();
        expect(carried).toEqual(wanted);

        // Every request, also Firefox's own, came with the credentials at once:
        // the proxy never had to ask the browser for them.
        expect(httpProxy.events.length).toBeGreaterThanOrEqual(wanted.length);
        expect(
          httpProxy.events.filter((event) => event.status === 407),
        ).toEqual([]);
        expect(
          new Set(httpProxy.events.map((event) => event.username)),
        ).toEqual(new Set(['alice']));

        // A loopback address goes through the proxy as well: a session never
        // talks to the computer it runs on, so the proxy (which is on this
        // computer in the test) is asked for it and fetches it for the browser.
        const direct = onLoopback('/p/direct?via=http');
        await visit(app, withHttp.id, direct);
        expect(atSite('http')).toEqual(
          [...wanted, '/p/direct?via=http'].sort(),
        );
        expect(
          httpProxy.events
            .filter((event) => event.target.includes('/direct'))
            .map((event) => [event.target, event.username]),
        ).toEqual([[direct, 'alice']]);
      },
      TIMEOUT_MS,
    );

    it(
      'tunnels an https address through the proxy as well',
      async () => {
        // The site speaks no TLS, so the page fails; what counts is the way it went.
        const secure = `https://${SITE_HOST}:${site.port}/p/tls?via=http`;
        await expect(
          app.manager.remote(withHttp.id).goto(secure, null, 'load'),
        ).rejects.toThrow(/SSL_ERROR/u);

        const tunnels = httpProxy.events.filter(
          (event) => event.kind === 'CONNECT' && event.host === SITE_HOST,
        );
        expect(tunnels.length).toBeGreaterThan(0);
        expect(
          tunnels.every(
            (event) =>
              event.port === site.port &&
              event.username === 'alice' &&
              event.ok,
          ),
        ).toBe(true);
      },
      TIMEOUT_MS,
    );

    it(
      'never gives the browser the password of its proxy',
      async () => {
        const profile = app.profileDir(withHttp.id);
        const launched = app.backend.launched.find(
          (spec) => spec.profileDir === profile,
        );
        expect(launched).toBeDefined();
        // The browser is told about the local bridge, which has no credentials.
        expect(Object.keys(launched?.proxy ?? {})).toEqual(['server']);
        const bridge = new URL(launched?.proxy.server ?? '');
        expect(bridge.hostname).toBe('127.0.0.1');
        expect(Number(bridge.port)).not.toBe(httpProxy.port);
        const secrets = [
          's3cr#t:@x',
          's3cr%23t%3A%40x',
          Buffer.from('alice:s3cr#t:@x').toString('base64'),
        ];
        const pid = await findBrowserPid(profile);
        const row = (await processTable()).find((r) => r.pid === pid);
        expect(row).toBeDefined();
        for (const secret of secrets) {
          expect(JSON.stringify(launched)).not.toContain(secret);
          expect(row?.command ?? '').not.toContain(secret);
          expect(filesContaining(profile, secret)).toEqual([]);
        }
      },
      TIMEOUT_MS,
    );

    it(
      'sends a page and all it loads through a SOCKS5 proxy that needs credentials',
      async () => {
        await untilTabs(app, withSocks.id, [onSite('/storage.html?via=socks')]);
        await loadAssets(withSocks, 'socks');

        const hits = socksProxy.events.filter(
          (event) => event.host === SITE_HOST,
        );
        // The bridge speaks SOCKS5 to the proxy, with the credentials and the
        // name of the site, which the proxy resolves.
        expect(hits.length).toBe(atSite('socks').length);
        expect(atSite('socks')).toHaveLength(4);
        expect(
          hits.every(
            (event) =>
              event.username === 'sockuser' &&
              event.addrType === 'domain' &&
              event.ok,
          ),
        ).toBe(true);
        expect(app.manager.session(withSocks.id).status).toBe('running');

        // An https address is a tunnel through it, to the name of the site.
        const secure = `https://${SITE_HOST}:${site.port}/p/tls?via=socks`;
        await expect(
          app.manager.remote(withSocks.id).goto(secure, null, 'load'),
        ).rejects.toThrow(/SSL_ERROR/u);
        expect(
          socksProxy.events.filter(
            (event) => event.host === SITE_HOST && event.port === site.port,
          ).length,
        ).toBeGreaterThan(hits.length);
      },
      TIMEOUT_MS,
    );

    it(
      'fails the page of a session whose proxy is dead, and nothing reaches the site',
      async () => {
        const dead = await scope.proxy();
        await routeThrough(app, dead, EXIT.berlin);
        const { port } = dead;
        await dead.stop();
        app.manager.updateSettings({
          startPage: onSite('/storage.html?via=dead'),
        });
        const session = await startSession(app, 'dead');
        const remote = app.manager.remote(session.id);

        // Firefox says why; it does not try the site on its own.
        await expect
          .poll(async () => (await remote.readPage()).problem, POLL)
          .toMatch(/proxy server that is refusing connections/);
        expect(remote.tabs().map((tab) => tab.url)).toEqual([
          onSite('/storage.html?via=dead'),
        ]);
        await expect(
          remote.goto(onSite('/p/other?via=dead'), null, 'load'),
        ).rejects.toThrow(/PROXY_CONNECTION_REFUSED/);
        expect(atSite('dead')).toEqual([]);

        // The same browser reaches the site once the proxy is back, through it.
        const back = await scope.proxy({ port });
        await remote.goto(onSite('/p/back?via=dead'), null, 'load');
        expect(back.targets('HTTP')).toEqual([onSite('/p/back?via=dead')]);
        expect(atSite('dead')).toEqual(['/p/back?via=dead']);
      },
      TIMEOUT_MS,
    );

    it(
      'fails the page of a session whose proxy with credentials is dead, and nothing reaches the site',
      async () => {
        const dead = await scope.proxy({ username: 'carol', password: 'pw1' });
        await routeThrough(app, dead, EXIT.tokyo);
        const { port } = dead;
        await dead.stop();
        app.manager.updateSettings({
          startPage: onSite('/storage.html?via=deadauth'),
        });
        const session = await startSession(app, 'deadauth');
        const remote = app.manager.remote(session.id);

        // The bridge answers in the proxy's place, and says so in its log
        // without the password.
        await expect
          .poll(async () => (await remote.readPage()).text, POLL)
          .toContain(
            '502 Bad Gateway: the upstream proxy refused the connection',
          );
        expect(atSite('deadauth')).toEqual([]);
        expect(app.bridgeLog.some((line) => line.includes('carol@'))).toBe(
          true,
        );
        expect(app.bridgeLog.join('\n')).not.toContain('pw1');

        const back = await scope.proxy({
          username: 'carol',
          password: 'pw1',
          port,
        });
        await remote.goto(onSite('/p/back?via=deadauth'), null, 'load');
        expect(back.targets('HTTP')).toEqual([onSite('/p/back?via=deadauth')]);
        expect(atSite('deadauth')).toEqual(['/p/back?via=deadauth']);
      },
      TIMEOUT_MS,
    );
  });

  // -- 2. isolation and persistence -----------------------------------------------------------

  describe('the data of a session', () => {
    const scope = new Scope();
    let app: RealManager;
    let a: Session;
    let b: Session;
    let proxyAId = 0;

    const STORED = z.object({
      cookie: z.string(),
      local: z.string().nullable(),
      indexed: z.string().nullable(),
    });

    /** Cookie, local storage and IndexedDB of the page's origin. */
    async function writeStorage(page: Page, owner: string): Promise<void> {
      await page.evaluate(async (who) => {
        document.cookie = `owner=${who}; max-age=86400; path=/`;
        localStorage.setItem('owner', who);
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const open = indexedDB.open('vault', 1);
          open.addEventListener('upgradeneeded', () => {
            open.result.createObjectStore('kv');
          });
          open.addEventListener('error', () => {
            reject(open.error);
          });
          open.addEventListener('success', () => {
            resolve(open.result);
          });
        });
        await new Promise<void>((resolve, reject) => {
          const transaction = database.transaction('kv', 'readwrite');
          transaction.objectStore('kv').put(who, 'owner');
          transaction.addEventListener('complete', () => {
            resolve();
          });
          transaction.addEventListener('error', () => {
            reject(transaction.error);
          });
        });
        database.close();
      }, owner);
    }

    async function readStorage(page: Page) {
      const read: unknown = await page.evaluate(async () => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const open = indexedDB.open('vault', 1);
          // A profile that has never written has nothing in it.
          open.addEventListener('upgradeneeded', () => {
            open.result.createObjectStore('kv');
          });
          open.addEventListener('error', () => {
            reject(open.error);
          });
          open.addEventListener('success', () => {
            resolve(open.result);
          });
        });
        const indexed = await new Promise<string | null>((resolve, reject) => {
          const get = database.transaction('kv').objectStore('kv').get('owner');
          get.addEventListener('success', () => {
            resolve(typeof get.result === 'string' ? get.result : null);
          });
          get.addEventListener('error', () => {
            reject(get.error);
          });
        });
        database.close();
        return {
          cookie: document.cookie,
          local: localStorage.getItem('owner'),
          indexed,
        };
      });
      return STORED.parse(read);
    }

    const owned = (owner: string) => ({
      cookie: `owner=${owner}`,
      local: owner,
      indexed: owner,
    });
    const nothing = { cookie: '', local: null, indexed: null };

    beforeAll(async () => {
      app = appFor(scope);
      const proxyA = await scope.proxy();
      const proxyB = await scope.proxy();
      proxyAId = await routeThrough(app, proxyA, EXIT.chicago);
      a = await startSession(app, 'a');
      await routeThrough(app, proxyB, EXIT.berlin);
      b = await startSession(app, 'b');
    }, SETUP_TIMEOUT_MS);

    afterAll(() => scope.close());

    it(
      'keeps the cookies, local storage and IndexedDB of a session out of sight of another session',
      async () => {
        const pageA = await visit(app, a.id, onSite('/storage.html'));
        await writeStorage(pageA, 'a');
        expect(await readStorage(pageA)).toEqual(owned('a'));

        // The same address in the other session: nothing of the first one.
        const pageB = await visit(app, b.id, onSite('/storage.html'));
        expect(await readStorage(pageB)).toEqual(nothing);
        await writeStorage(pageB, 'b');
        expect(await readStorage(pageB)).toEqual(owned('b'));
        expect(await readStorage(pageA)).toEqual(owned('a'));
      },
      TIMEOUT_MS,
    );

    it(
      'keeps them over a stop and a start',
      async () => {
        await stopSession(app, a.id);
        await resume(app, a.id);
        await untilTabs(app, a.id, [onSite('/storage.html')]);
        const again = await visit(app, a.id, onSite('/storage.html'));
        expect(await readStorage(again)).toEqual(owned('a'));
      },
      TIMEOUT_MS,
    );

    it(
      'removes the profile directory with the session, and leaves the other session its data',
      async () => {
        const profile = app.profileDir(a.id);
        expect(existsSync(profile)).toBe(true);

        await app.manager.deleteSession(a.id);

        expect(existsSync(profile)).toBe(false);
        expect(await findBrowserPid(profile)).toBeNull();
        expect(app.manager.listSessions().map((s) => s.name)).toEqual(['b']);
        // Its proxy is free for another session.
        expect(app.manager.proxy(proxyAId).session).toBeNull();
        const pageB = await visit(app, b.id, onSite('/storage.html'));
        expect(await readStorage(pageB)).toEqual(owned('b'));
        expect(app.manager.session(b.id).status).toBe('running');
      },
      TIMEOUT_MS,
    );
  });

  // -- 3. identity ------------------------------------------------------------------------------

  describe('the identity of a session', () => {
    const scope = new Scope();
    let app: RealManager;
    let sessions: Record<'w1' | 'w2' | 'mac' | 'lin', Session>;

    const probeSchema = z.object({
      navigator: z.record(z.string(), z.unknown()),
      screen: z.record(z.string(), z.unknown()),
      window: z.record(z.string(), z.unknown()),
      webgl: z.record(z.string(), z.unknown()),
      webgl2: z.record(z.string(), z.unknown()),
      fonts: z.record(z.string(), z.unknown()),
      canvas: z.record(z.string(), z.unknown()),
      audio: z.record(z.string(), z.unknown()),
    });

    function pick(
      record: Record<string, unknown>,
      keys: readonly string[],
    ): Record<string, unknown> {
      return Object.fromEntries(keys.map((key) => [key, record[key]]));
    }

    const GRAPHICS = [
      'vendor',
      'renderer',
      'unmaskedVendor',
      'unmaskedRenderer',
      'extensionCount',
      'paramsHash',
      'renderHash',
    ];

    /**
     * What a page reads of the browser and a fingerprinting script would hash.
     * Not the speech voices (the browser lists them when it likes) and not the
     * canvas as a data URL (Firefox puts noise of its own in it).
     */
    /**
     * On a macOS host Camoufox resolves the generic font families (and the
     * fallback fonts of canvas text) to another font while a browser is new:
     * the first canvas text a content process measures starts setting its font
     * list up, and that takes a few hundred milliseconds. A page that looks in
     * that moment reads other base metrics and a differently drawn text canvas
     * than one that looks later, whatever the identity says. They are compared
     * between starts on other hosts only (the container image is Linux).
     */
    function withoutHostNoise<T extends Awaited<ReturnType<typeof probeOf>>>(
      probe: T,
    ): T {
      if (process.platform !== 'darwin') return probe;
      return {
        ...probe,
        fonts: omit(probe.fonts, ['baseMetrics', 'metricsHash']),
        canvas: omit(probe.canvas, ['pixelHash']),
      };
    }

    function omit(
      record: Record<string, unknown>,
      keys: readonly string[],
    ): Record<string, unknown> {
      return Object.fromEntries(
        Object.entries(record).filter(([key]) => !keys.includes(key)),
      );
    }

    async function probeOf(session: Session) {
      const found = await runProbe(
        activePage(app, session.id),
        pages.url('/probe.html', SITE_HOST),
      );
      const probe = probeSchema.parse(found);
      return {
        navigator: probe.navigator,
        screen: probe.screen,
        window: probe.window,
        webgl: pick(probe.webgl, GRAPHICS),
        webgl2: pick(probe.webgl2, GRAPHICS),
        fonts: pick(probe.fonts, [
          'available',
          'count',
          'baseMetrics',
          'listHash',
          'metricsHash',
        ]),
        // The text canvas reads differently from one read to the next (the
        // same way after every start): the first read of a start is compared.
        canvas: pick(probe.canvas, ['shapesPixelHash', 'pixelHash']),
        audio: pick(probe.audio, ['hash', 'sum']),
      };
    }

    beforeAll(async () => {
      app = appFor(scope);
      const exits = [EXIT.chicago, EXIT.zurich, EXIT.berlin, EXIT.tokyo];
      for (const exit of exits) {
        await routeThrough(app, await scope.proxy(), exit);
      }
      const [w1, w2, mac, lin] = await Promise.all([
        startSession(app, 'w1', 'windows'),
        startSession(app, 'w2', 'windows'),
        startSession(app, 'mac', 'macos'),
        startSession(app, 'lin', 'linux'),
      ]);
      sessions = { w1, w2, mac, lin };
    }, SETUP_TIMEOUT_MS);

    afterAll(() => scope.close());

    it.each([
      ['w1', /^Win32$/u, /Windows NT/u, /^Windows NT/u],
      ['mac', /^MacIntel$/u, /Macintosh; Intel Mac OS X/u, /^Intel Mac OS X/u],
      // (Ubuntu's user agent says "X11; Ubuntu; Linux x86_64")
      ['lin', /^Linux /u, /X11;.* Linux /u, /^Linux /u],
    ] as const)(
      'shows the operating system that was chosen for %s in the platform and the user agent',
      async (name, platform, agent, oscpu) => {
        const session = sessions[name];
        const page = activePage(app, session.id);
        const seen = z.tuple([z.string(), z.string(), z.string()]).parse(
          // (`oscpu` is Firefox's own: a string keeps the DOM types out of it)
          await page.evaluate(
            '[navigator.platform, navigator.userAgent, navigator.oscpu]',
          ),
        );
        expect(seen[0]).toMatch(platform);
        expect(seen[1]).toMatch(agent);
        expect(seen[2]).toMatch(oscpu);
        // The list of sessions says the same.
        expect(session.fingerprint.platform).toBe(seen[0]);
        expect(session.fingerprint.userAgent).toBe(seen[1]);
      },
      TIMEOUT_MS,
    );

    it(
      'tells a page the same user agent, screen, platform, graphics card and fonts after every restart',
      async () => {
        const { w1 } = sessions;
        const before = await probeOf(w1);

        // What the list of sessions shows is what the page reads.
        const { fingerprint } = app.manager.session(w1.id);
        expect(before.navigator.userAgent).toBe(fingerprint.userAgent);
        expect(before.navigator.platform).toBe(fingerprint.platform);
        expect(
          `${String(before.screen.width)}x${String(before.screen.height)}`,
        ).toBe(fingerprint.screen);
        expect(before.webgl.unmaskedRenderer).toBe(fingerprint.gpu);
        expect(before.fonts.count).toBeGreaterThan(10);

        // A start with the page read last would count a read more in the canvas.
        await app.manager
          .remote(w1.id)
          .goto(onSite('/storage.html'), null, 'load');
        for (let restart = 0; restart < 2; restart++) {
          await stopSession(app, w1.id);
          await resume(app, w1.id);
          await untilTabs(app, w1.id, [onSite('/storage.html')]);
          expect(withoutHostNoise(await probeOf(w1))).toEqual(
            withoutHostNoise(before),
          );
          expect(app.manager.session(w1.id).fingerprint).toEqual(fingerprint);
          await app.manager
            .remote(w1.id)
            .goto(onSite('/storage.html'), null, 'load');
        }
      },
      TIMEOUT_MS,
    );

    it(
      'tells a page something else in two sessions of the same operating system',
      async () => {
        const [first, second] = [
          await probeOf(sessions.w1),
          await probeOf(sessions.w2),
        ];
        expect(first.navigator.platform).toBe(second.navigator.platform);
        expect(first).not.toEqual(second);
        // The spacing of the fonts is drawn per session.
        expect(first.fonts.metricsHash).not.toBe(second.fonts.metricsHash);
        expect(app.manager.session(sessions.w1.id).fingerprint).not.toEqual(
          app.manager.session(sessions.w2.id).fingerprint,
        );
      },
      TIMEOUT_MS,
    );
  });

  // -- 4. the place follows the exit IP, 7. rotating and restarting ---------------------------------

  describe('the place of a session', () => {
    const scope = new Scope();
    let app: RealManager;
    let first: AnyProxy;
    let second: AnyProxy;
    let session: Session;
    let exits: ExitPoint[];
    let secondId = 0;

    async function whereIs() {
      const page = await visit(app, session.id, onLoopback('/where.html'));
      return whereSchema.parse(await readOut(page));
    }

    async function webrtcOf() {
      const page = await visit(app, session.id, onLoopback('/webrtc.html'));
      return webrtcSchema.parse(await readOut(page));
    }

    /** What a page that looks the exit IP up in the GeoIP database expects of the clock of a session. */
    async function expectTheClockOf(exit: ExitPoint) {
      const geo = await lookup(exit.ip);
      const found = await whereIs();
      expect(found.timeZone).toBe(geo.timezone);
      expect(found.january).toBe(offsetOf(geo.timezone, JANUARY));
      expect(found.july).toBe(offsetOf(geo.timezone, JULY));
      expect(found.dateString).toContain(gmtOf(offsetOf(geo.timezone, SAMPLE)));
      return { geo, found };
    }

    beforeAll(async () => {
      // Where this host is shows in a page whatever the browser does.
      exits = await awayFromHere([
        EXIT.tokyo,
        EXIT.chicago,
        EXIT.sydney,
        EXIT.berlin,
      ]);
      expect(exits.length).toBeGreaterThanOrEqual(3);
      app = appFor(scope);
      first = await scope.proxy();
      second = await scope.proxy({ username: 'bob', password: 'pw2' });
      await routeThrough(app, first, exits[0]);
      session = await startSession(app, 'place');
    }, SETUP_TIMEOUT_MS);

    afterAll(() => scope.close());

    it(
      'tells a page the time zone, the clock and the language of the exit IP',
      async () => {
        const [home] = exits;
        const { geo, found } = await expectTheClockOf(home);

        // The language is one of the country's, and the page says what the list says.
        expect(found.language).toMatch(
          new RegExp(`^[a-z]{2,3}-${home.country}$`, 'u'),
        );
        expect(found.language).toBe(session.fingerprint.locale);
        expect(found.languages[0]).toBe(found.language);
        const listed = app.manager.session(session.id);
        expect(listed.fingerprint.timezone).toBe(geo.timezone);
        expect(listed.location).toEqual({
          ip: home.ip,
          country: home.country,
          timezone: geo.timezone,
          latitude: geo.latitude,
          longitude: geo.longitude,
          inSync: true,
        });
      },
      TIMEOUT_MS,
    );

    // The launch gives Camoufox the coordinates of the exit IP
    // (`geolocation:latitude` and `longitude`), but this build (152.0.4-beta.30
    // with camoufox-js 0.13) does not deliver them: `permissions.query` would
    // say "prompt" and `getCurrentPosition` never answer, since a headless
    // browser cannot ask (and the timers of the page stop while it waits).
    // `launch` therefore gives the context the position and the permission
    // (`setGeolocation`, `grantPermissions`). The README promises that a page
    // sees the coordinates that the GeoIP database gives for that IP.
    it(
      'gives a page that asks for the position the coordinates of the exit IP',
      async () => {
        const geo = await lookup(exits[0].ip);
        const page = await visit(app, session.id, onLoopback('/position.html'));
        // As in any browser whose person has not been asked yet: the state is
        // "prompt", and the page is answered all the same, at once.
        const asked = positionSchema
          .pick({ secure: true, permission: true })
          .parse(await readOut(page, { stage: 'permission' }));
        expect(asked.secure).toBe(true);

        const found = positionSchema.parse(await readOut(page));
        expect(found.position).toEqual({
          lat: geo.latitude,
          lon: geo.longitude,
          accuracy: expect.any(Number),
        });
      },
      TIMEOUT_MS,
    );

    it(
      'offers a page through WebRTC no address of this host, only the exit IP and names of its own',
      async () => {
        const [home] = exits;
        const found = await webrtcOf();
        expect(found.available).toBe(true);
        expect(found.error).toBeNull();

        const candidates = found.candidates.map(candidateOf);
        expect(candidates.length).toBeGreaterThan(0);
        const own = ownAddresses();
        for (const { address } of candidates) {
          // A name that means nothing outside the browser, or the exit IP.
          expect(
            address === home.ip || /^[0-9a-f-]+\.local$/u.test(address),
            address,
          ).toBe(true);
          expect(own.has(address)).toBe(false);
        }
        // The address that a site sees anyway is the one it is told.
        expect(
          candidates.some(
            (candidate) =>
              candidate.address === home.ip && candidate.type === 'srflx',
          ),
        ).toBe(true);
        // The offer says no more than the candidates do.
        const addressesInOffer =
          found.sdp.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/gu) ?? [];
        for (const address of addressesInOffer) {
          expect(['0.0.0.0', home.ip], address).toContain(address);
        }
        expect(found.sdp).not.toContain('127.0.0.1');
      },
      TIMEOUT_MS,
    );

    it(
      'keeps the same place over a stop and a start while the exit IP is the same',
      async () => {
        const before = await whereIs();
        await stopSession(app, session.id);
        await resume(app, session.id);
        expect(await whereIs()).toEqual(before);
        expect(app.manager.session(session.id).location?.inSync).toBe(true);
      },
      TIMEOUT_MS,
    );

    it(
      'gives a session the language and the WebRTC address of another country after its proxy was rotated, and loads pages through the new proxy',
      async () => {
        const [home, away] = exits;
        const before = app.manager.session(session.id);
        secondId = await routeThrough(app, second, away);
        const oldTraffic = first.events.length;

        const rotating = await app.manager.rotateSession(session.id);
        expect(rotating.status).toBe('starting');
        const rotated = await untilRunning(app, session.id);

        expect(rotated.proxy?.id).toBe(secondId);
        expect(rotated.proxy?.exitIp).toBe(away.ip);
        expect(rotated.fingerprint.userAgent).toBe(
          before.fingerprint.userAgent,
        );
        const geo = await lookup(away.ip);
        expect(rotated.location).toEqual({
          ip: away.ip,
          country: away.country,
          timezone: geo.timezone,
          latitude: geo.latitude,
          longitude: geo.longitude,
          inSync: true,
        });
        expect(rotated.fingerprint.timezone).not.toBe(
          before.fingerprint.timezone,
        );

        // The language is drawn again for the new country.
        const found = await whereIs();
        expect(found.language).toBe(rotated.fingerprint.locale);
        expect(found.language).toMatch(
          new RegExp(`^[a-z]{2,3}-${away.country}$`, 'u'),
        );
        const candidates = (await webrtcOf()).candidates.map(candidateOf);
        expect(candidates.some((c) => c.address === away.ip)).toBe(true);
        expect(candidates.some((c) => c.address === home.ip)).toBe(false);

        // New page loads go through the new proxy, with its credentials, and not through the old one.
        await visit(app, session.id, onSite('/p/after-rotate'));
        expect(second.targets('HTTP')).toContain(onSite('/p/after-rotate'));
        expect(new Set(second.events.map((event) => event.username))).toEqual(
          new Set(['bob']),
        );
        expect(first.events.length).toBe(oldTraffic);
      },
      TIMEOUT_MS,
    );

    // Camoufox 152.0.4-beta.30 saves the time zone it was configured with in the
    // profile (`prefs.js`: `roverfox.s.timezone_0`) and a later launch with
    // another `timezone` in its config does not replace it. After "Rotate IP" to
    // a proxy in another zone, or a "Restart" after the proxy's exit moved, the
    // pages would still read the old zone and clock, while the language, the
    // WebRTC address and `location` follow the new IP: the README promises that
    // the place fits the exit IP at every start. `locationConfig` therefore
    // passes the zone as the preference `firefox_user_prefs['roverfox.s.timezone_0']`
    // at every launch.
    it(
      'puts the clock of the pages in the time zone of the new exit IP once the proxy was rotated',
      async () => {
        await expectTheClockOf(exits[1]);
      },
      TIMEOUT_MS,
    );

    it(
      'works out the place anew at a restart, for the exit IP the proxy has then',
      async () => {
        const [, , elsewhere] = exits;
        // The provider moved the proxy's exit.
        exitThrough(app, second, elsewhere);
        await app.manager.checkSessionIp(session.id);
        expect(app.manager.session(session.id).location?.inSync).toBe(false);
        const oldTraffic = first.events.length;
        const secondTraffic = second.events.length;

        const restarting = await app.manager.restartSession(session.id);
        expect(restarting.status).toBe('starting');
        const restarted = await untilRunning(app, session.id);

        expect(restarted.proxy?.id).toBe(secondId);
        expect(restarted.proxy?.exitIp).toBe(elsewhere.ip);
        expect(restarted.location).toMatchObject({
          ip: elsewhere.ip,
          country: elsewhere.country,
          timezone: (await lookup(elsewhere.ip)).timezone,
          inSync: true,
        });
        const found = await whereIs();
        expect(found.language).toBe(restarted.fingerprint.locale);
        expect(found.language).toMatch(
          new RegExp(`^[a-z]{2,3}-${elsewhere.country}$`, 'u'),
        );
        const candidates = (await webrtcOf()).candidates.map(candidateOf);
        expect(candidates.some((c) => c.address === elsewhere.ip)).toBe(true);

        // It is still the same proxy, and the new loads go through it.
        await visit(app, session.id, onSite('/p/after-restart'));
        expect(second.targets('HTTP')).toContain(onSite('/p/after-restart'));
        expect(second.events.length).toBeGreaterThan(secondTraffic);
        expect(first.events.length).toBe(oldTraffic);
      },
      TIMEOUT_MS,
    );

    // The same as after the rotation (`roverfox.s.timezone_0`).
    it(
      'puts the clock of the pages in the time zone of the exit IP the proxy has after a restart',
      async () => {
        await expectTheClockOf(exits[2]);
      },
      TIMEOUT_MS,
    );
  });

  describe('when the app blocks WebRTC', () => {
    const scope = new Scope();
    let app: RealManager;
    let session: Session;

    beforeAll(async () => {
      app = appFor(scope, { blockWebrtc: true });
      await routeThrough(app, await scope.proxy(), EXIT.berlin);
      session = await startSession(app, 'blocked');
    }, SETUP_TIMEOUT_MS);

    afterAll(() => scope.close());

    it(
      'takes RTCPeerConnection away from the pages of a session',
      async () => {
        const page = await visit(app, session.id, onLoopback('/webrtc.html'));
        const found = webrtcSchema.parse(await readOut(page));
        expect(found.available).toBe(false);
        expect(found.candidates).toEqual([]);
      },
      TIMEOUT_MS,
    );
  });

  // -- 5. tabs ----------------------------------------------------------------------------------

  describe('the tabs of a session', () => {
    const scope = new Scope();
    let app: RealManager;
    let proxy: AnyProxy;
    let session: Session;

    const START = (): string => onSite('/storage.html');
    const TWO = (): string => onSite('/p/two');
    const THREE = (): string => onSite('/p/three');
    const FOUR = (): string => onSite('/p/four');

    beforeAll(async () => {
      app = appFor(scope);
      proxy = await scope.proxy();
      await routeThrough(app, proxy, EXIT.berlin);
      session = await startSession(app, 'tabs', 'macos');
      await untilTabs(app, session.id, [START()]);
    }, SETUP_TIMEOUT_MS);

    afterAll(() => scope.close());

    it(
      'brings the same tabs back after a stop and a start, at the addresses they had got to, the one that was in front in front',
      async () => {
        const remote = app.manager.remote(session.id);
        await remote.openTab(TWO());
        await remote.openTab(THREE());
        await untilTabs(app, session.id, [START(), TWO(), THREE()]);
        const [, second, third] = remote.tabs();
        // The third tab goes on to another page: that is the one to come back.
        await remote.goto(FOUR(), third?.id, 'load');
        await remote.activateTab(second?.id ?? -1);
        // The browser tells the manager which tabs to reopen, a moment after they changed.
        await expect
          .poll(() => storedLayout(app, session.id), POLL)
          .toEqual({ urls: [START(), TWO(), FOUR()], active: 1 });

        await stopSession(app, session.id);
        await resume(app, session.id);

        await untilTabs(app, session.id, [START(), TWO(), FOUR()]);
        expect(
          app.manager
            .remote(session.id)
            .tabs()
            .map((tab) => tab.active),
        ).toEqual([false, true, false]);
        await expect
          .poll(async () => {
            const tabs = await app.manager.remote(session.id).listTabs();
            return tabs.map((tab) => tab.title);
          }, POLL)
          .toEqual(['storage', 'two', 'four']);
      },
      TIMEOUT_MS,
    );

    it(
      'does not reopen a tab that is no web page, and reopens a page that failed to load as the page that was wanted',
      async () => {
        const remote = app.manager.remote(session.id);
        const gone = onSite('/p/gone');
        // A blank tab, and then the proxy dies and a page fails.
        await remote.openTab('about:blank');
        await expect.poll(() => remote.tabs().length, POLL).toBe(4);
        const { port } = proxy;
        await proxy.stop();
        const third = remote.tabs()[2];
        await expect(remote.goto(gone, third?.id, 'load')).rejects.toThrow(
          /PROXY_CONNECTION_REFUSED/,
        );
        await remote.activateTab(third?.id ?? -1);

        // What the tab shows is the address that failed, not Firefox's error page.
        await expect
          .poll(() => remote.tabs().map((tab) => tab.url), POLL)
          .toEqual([START(), TWO(), gone, '']);
        expect((await remote.readPage(third?.id)).problem).toMatch(
          /refusing connections/,
        );
        await expect
          .poll(() => storedLayout(app, session.id), POLL)
          .toEqual({ urls: [START(), TWO(), gone], active: 2 });

        await stopSession(app, session.id);
        // With its proxy back the browser opens the page it was asked for.
        await scope.proxy({ port });
        await resume(app, session.id);

        await untilTabs(app, session.id, [START(), TWO(), gone]);
        await expect
          .poll(async () => {
            const tabs = await app.manager.remote(session.id).listTabs();
            return tabs.map((tab) => tab.title);
          }, POLL)
          .toEqual(['storage', 'two', 'gone']);
      },
      TIMEOUT_MS,
    );

    it(
      'ends the session when its last tab is closed, and opens the start page at the next start',
      async () => {
        const remote = app.manager.remote(session.id);
        const profile = app.profileDir(session.id);
        for (const tab of remote.tabs()) await remote.closeTab(tab.id);

        await waitFor(
          app.manager,
          session.id,
          (current) =>
            current.status === 'stopped' && current.activity === null,
          STOP_TIMEOUT_MS,
        );
        await expect.poll(() => findBrowserPid(profile), POLL).toBeNull();
        // The user said "done": the tabs are forgotten.
        expect(storedLayout(app, session.id)).toBeNull();

        // The start page as it is now.
        app.manager.updateSettings({ startPage: onSite('/p/fresh') });
        await resume(app, session.id);
        await untilTabs(app, session.id, [onSite('/p/fresh')]);
      },
      TIMEOUT_MS,
    );
  });

  // -- 6. a crash -------------------------------------------------------------------------------

  describe('a browser that is killed', () => {
    const scope = new Scope();
    let app: RealManager;
    let session: Session;

    beforeAll(async () => {
      app = appFor(scope);
      const proxy = await scope.proxy({ username: 'dave', password: 'pw3' });
      await routeThrough(app, proxy, EXIT.tokyo);
      session = await startSession(app, 'crash', 'linux');
    }, SETUP_TIMEOUT_MS);

    afterAll(() => scope.close());

    it(
      'ends its session as stopped, lets go of everything, and starts again with its tabs and data',
      async () => {
        const profile = app.profileDir(session.id);
        const START = onSite('/storage.html');
        const TWO = onSite('/p/two');
        await untilTabs(app, session.id, [START]);
        const page = await visit(app, session.id, START);
        await page.evaluate(() => {
          document.cookie = 'owner=crash; max-age=86400; path=/';
        });
        await app.manager.remote(session.id).openTab(TWO);
        await untilTabs(app, session.id, [START, TWO]);
        await expect
          .poll(() => storedLayout(app, session.id)?.urls, POLL)
          .toEqual([START, TWO]);
        const before = app.manager.session(session.id);
        const bridge = new URL(app.backend.launched.at(-1)?.proxy.server ?? '');
        expect(await listening(Number(bridge.port))).toBe(true);

        // Only the browser's own process: found the way the backend finds it.
        const pid = await findBrowserPid(profile);
        if (pid === null) throw new Error('the browser has no process');
        process.kill(pid, 'SIGKILL');

        const ended = await waitFor(
          app.manager,
          session.id,
          (current) => current.status !== 'running',
          STOP_TIMEOUT_MS,
        );
        expect(ended).toMatchObject({
          status: 'stopped',
          error: null,
          errorCode: null,
        });
        // Nothing is left: no process of the browser, no bridge for its proxy.
        await expect
          .poll(() => browserProcesses(basename(app.dataDir)), POLL)
          .toEqual([]);
        await expect
          .poll(() => listening(Number(bridge.port)), POLL)
          .toBe(false);
        expect(() => app.manager.remote(session.id)).toThrow(/not running/i);

        // It starts again as it was.
        const again = await resume(app, session.id);
        expect(again.fingerprint).toEqual(before.fingerprint);
        expect(again.location).toEqual(before.location);
        await untilTabs(app, session.id, [START, TWO]);
        const reopened = await visit(app, session.id, START);
        const cookie = await reopened.evaluate(() => document.cookie);
        expect(cookie).toBe('owner=crash');
      },
      TIMEOUT_MS,
    );
  });

  // -- 8. sessions side by side -----------------------------------------------------------------

  describe('two sessions at once', () => {
    const scope = new Scope();
    let app: RealManager;
    let proxyX: AnyProxy;
    let proxyY: AnyProxy;
    let x: Session;
    let y: Session;
    let exits: ExitPoint[];

    beforeAll(async () => {
      exits = await awayFromHere([EXIT.tokyo, EXIT.chicago, EXIT.sydney]);
      app = appFor(scope);
      proxyX = await scope.proxy();
      proxyY = await scope.proxy({ username: 'erin', password: 'pw4' });
      await routeThrough(app, proxyX, exits[0]);
      x = await startSession(app, 'x', 'windows');
      await routeThrough(app, proxyY, exits[1]);
      y = await startSession(app, 'y', 'macos');
    }, SETUP_TIMEOUT_MS);

    afterAll(() => scope.close());

    it(
      'lets each page see its own exit',
      async () => {
        const pageX = await visit(app, x.id, onLoopback('/where.html'));
        const pageY = await visit(app, y.id, onLoopback('/where.html'));
        const seenByX = whereSchema.parse(await readOut(pageX));
        const seenByY = whereSchema.parse(await readOut(pageY));
        expect(seenByX.timeZone).toBe((await lookup(exits[0].ip)).timezone);
        expect(seenByY.timeZone).toBe((await lookup(exits[1].ip)).timezone);
        expect(seenByX.timeZone).not.toBe(seenByY.timeZone);

        // Each one's pages arrive through its own proxy, and only through that.
        await visit(app, x.id, onSite('/p/only-x'));
        await visit(app, y.id, onSite('/p/only-y'));
        expect(proxyX.targets('HTTP')).toContain(onSite('/p/only-x'));
        expect(proxyX.targets('HTTP')).not.toContain(onSite('/p/only-y'));
        expect(proxyY.targets('HTTP')).toContain(onSite('/p/only-y'));
        expect(proxyY.targets('HTTP')).not.toContain(onSite('/p/only-x'));
        expect(app.manager.session(x.id).proxy?.exitIp).toBe(exits[0].ip);
        expect(app.manager.session(y.id).proxy?.exitIp).toBe(exits[1].ip);
      },
      TIMEOUT_MS,
    );

    it(
      'leaves the other session running when one is stopped',
      async () => {
        const profileX = app.profileDir(x.id);
        expect(await findBrowserPid(profileX)).not.toBeNull();

        const stopped = await stopSession(app, x.id);

        expect(stopped.status).toBe('stopped');
        await expect.poll(() => findBrowserPid(profileX), POLL).toBeNull();
        expect(app.manager.session(y.id).status).toBe('running');
        expect(app.manager.meta().counts.running).toBe(1);
        // Its browser still works, through its proxy.
        const before = proxyY.targets('HTTP').length;
        await visit(app, y.id, onSite('/p/y-again'));
        expect(proxyY.targets('HTTP').length).toBeGreaterThan(before);
        expect(proxyY.targets('HTTP')).toContain(onSite('/p/y-again'));
      },
      TIMEOUT_MS,
    );
  });
});
