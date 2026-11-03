// The real manager over the real browser, for the service-level tests of the
// real-browser lane. What is real: the store (a file), the identities, the
// GeoIP database, the credential bridge, Camoufox and its profile directories.
// What is faked is the exit-IP check (`FakeExitIpChecker`: each proxy exits
// through the address the test says, so that the GeoIP database, which is
// offline, knows it; nothing leaves the host).
//
//     const app = createRealManager();
//     afterAll(() => app.close());
//
//     const proxy = await new HttpProxy({ hosts: SITE_HOSTS }).start();
//     await routeThrough(app, proxy, EXIT.zurich);    // the proxy joins the pool
//     const session = await startSession(app, 'a');   // created, and running
//     await visit(app, session.id, `http://${SITE_HOST}:${port}/storage.html`);
//
// A session whose proxy is at 127.0.0.1 reaches a page under a made-up host
// name (`SITE_HOST`): the proxy routes the name to the page server
// (`HttpProxy`'s `hosts`). A loopback address of the page server goes through
// the proxy too (a session never talks to the computer it runs on), so a test
// can tell the two apart by the host name the proxy was asked for.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Page } from 'playwright-core';
import { expect, vi } from 'vitest';

import type { Session } from '../../lib/api/schemas.ts';
import { openStore } from '../db/store.ts';
import type { Store } from '../db/store.ts';
import { ProxyBridge } from '../domains/proxies/bridge.ts';
import type { Manager } from '../domains/sessions/manager.ts';
import { createManager } from '../domains/sessions/service.ts';
import type { TabLayout } from '../lib/web-url.ts';
import { FakeExitIpChecker } from './fake-exit-ip.ts';
import { addProxy, waitFor, waitForChecks } from './harness.ts';
import type { HttpProxy, Socks5Proxy } from './local-proxies.ts';
import { RecordingBackend, pageInFront } from './real-browser.ts';
import type { RecordingBackendOptions } from './real-browser.ts';

/** The made-up host name of the page server: the test proxies route it to 127.0.0.1. */
export const SITE_HOST = 'probe.test';
export const SITE_HOSTS: Readonly<Record<string, string>> = {
  [SITE_HOST]: '127.0.0.1',
};

/**
 * Addresses the (offline) GeoIP database knows, and what it says of them: the
 * exit IPs of the proxies in the tests. An address that the database does not
 * know (the documentation ranges, say) would stop a session from starting.
 */
export const EXIT = {
  /** United States, America/Chicago */
  chicago: { ip: '8.8.8.8', country: 'US' },
  /** Switzerland, Europe/Zurich */
  zurich: { ip: '62.2.17.60', country: 'CH' },
  /** Germany, Europe/Berlin */
  berlin: { ip: '5.9.0.1', country: 'DE' },
  /** Japan, Asia/Tokyo */
  tokyo: { ip: '133.242.0.1', country: 'JP' },
  /** Australia, Australia/Sydney */
  sydney: { ip: '103.0.0.1', country: 'AU' },
} as const;

export type ExitPoint = (typeof EXIT)[keyof typeof EXIT];

/** A browser takes a few seconds to start; a loaded host may take much longer. */
export const LAUNCH_TIMEOUT_MS = 90_000;
/** A page of this host that a session shows is there in a moment. */
const PAGE_TIMEOUT_MS = 30_000;
/** A browser that is asked to close does so in a few seconds. */
export const STOP_TIMEOUT_MS = 40_000;

export type RealManagerOptions = RecordingBackendOptions;

export interface RealManager {
  manager: Manager;
  store: Store;
  backend: RecordingBackend;
  checker: FakeExitIpChecker;
  dataDir: string;
  /** What the credential bridges logged (they log the requests their proxy did not carry). */
  bridgeLog: string[];
  /** `profiles/<session id>` of the data directory. */
  profileDir(sessionId: number): string;
  /** Closes every browser and the store, and removes the data directory. */
  close(): Promise<void>;
}

export function createRealManager(
  options: RealManagerOptions = {},
): RealManager {
  const dataDir = mkdtempSync(join(tmpdir(), 'sm-real-'));
  const store = openStore(join(dataDir, 'manager.db'));
  const backend = new RecordingBackend(options);
  const checker = new FakeExitIpChecker();
  const bridgeLog: string[] = [];
  const manager = createManager({
    dataDir,
    version: 'real-test',
    store,
    backend,
    checker,
    blockWebrtc: options.blockWebrtc,
    // The real bridge; it says what it could not carry, and the test reads that.
    startBridge: (upstream) =>
      ProxyBridge.start(upstream, { log: (line) => bridgeLog.push(line) }),
  });
  let closed = false;
  return {
    manager,
    store,
    backend,
    checker,
    dataDir,
    bridgeLog,
    profileDir: (sessionId) => join(dataDir, 'profiles', String(sessionId)),
    async close() {
      if (closed) return;
      closed = true;
      try {
        await manager.close();
        await backend.close();
      } finally {
        store.close();
        rmSync(dataDir, { recursive: true, force: true });
      }
    },
  };
}

// -- the pool ---------------------------------------------------------------------------

/** `host:port` as the fake checker names a proxy. */
function hostPortOf(proxy: HttpProxy | Socks5Proxy): string {
  return `127.0.0.1:${proxy.port}`;
}

/** From now on the proxy's check says it exits through `exit`. */
export function exitThrough(
  app: RealManager,
  proxy: HttpProxy | Socks5Proxy,
  exit: ExitPoint,
): void {
  app.checker.setIp(hostPortOf(proxy), exit.ip, exit.country);
}

/**
 * Adds the proxy to the pool; its check says it exits through `exit`. With
 * credentials it is added the way a person pastes it (`scheme://user:pass@...`).
 * Returns once the check is over, so that the next session finds it as a
 * working proxy.
 */
export async function routeThrough(
  app: RealManager,
  proxy: HttpProxy | Socks5Proxy,
  exit: ExitPoint,
): Promise<number> {
  exitThrough(app, proxy, exit);
  const added = addProxy(app.manager, proxy.urlWithAuth);
  await waitForChecks(app.manager, PAGE_TIMEOUT_MS);
  return added.id;
}

// -- sessions -----------------------------------------------------------------------------

/** The addresses of the tabs, in order. */
function tabUrls(app: RealManager, sessionId: number): string[] {
  return app.manager
    .remote(sessionId)
    .tabs()
    .map((tab) => tab.url);
}

/**
 * Creates a session (it takes the first free proxy), waits until its browser is
 * up and returns it as the list shows it. The first tab loads in the
 * background: see `untilTabs`.
 */
export async function startSession(
  app: RealManager,
  name: string,
  os: 'windows' | 'macos' | 'linux' = 'windows',
): Promise<Session> {
  const created = await app.manager.createSession({ name, os });
  return await untilRunning(app, created.id);
}

/** Until the session runs, or fails (with its error in the message). */
export async function untilRunning(
  app: RealManager,
  sessionId: number,
): Promise<Session> {
  const session = await waitFor(
    app.manager,
    sessionId,
    (current) =>
      current.status === 'error' ||
      (current.status === 'running' && current.activity === null),
    LAUNCH_TIMEOUT_MS,
  );
  if (session.status === 'error') {
    throw new Error(`session ${session.name} failed: ${session.error}`);
  }
  return session;
}

/** Until the tabs show these addresses (the pages load in the background). */
export async function untilTabs(
  app: RealManager,
  sessionId: number,
  urls: readonly string[],
): Promise<void> {
  await vi.waitFor(
    () => {
      expect(tabUrls(app, sessionId)).toEqual(urls);
    },
    { timeout: PAGE_TIMEOUT_MS, interval: 50 },
  );
}

/** Opens the address in the active tab and returns once the page has loaded. */
export async function visit(
  app: RealManager,
  sessionId: number,
  url: string,
): Promise<Page> {
  await app.manager.remote(sessionId).goto(url, null, 'load');
  return activePage(app, sessionId);
}

/** The Playwright page of the active tab. */
export function activePage(app: RealManager, sessionId: number): Page {
  return pageInFront(
    app.backend.sessionIn(app.profileDir(sessionId)),
    app.manager.remote(sessionId).tabs(),
  );
}

/** Stops the session and waits until it is stopped. */
export async function stopSession(
  app: RealManager,
  sessionId: number,
): Promise<Session> {
  await app.manager.stopSession(sessionId);
  return await waitFor(
    app.manager,
    sessionId,
    (session) => session.status === 'stopped' && session.activity === null,
    STOP_TIMEOUT_MS,
  );
}

/** Starts a stopped session again and waits until it is running. */
export async function resume(
  app: RealManager,
  sessionId: number,
): Promise<Session> {
  await app.manager.startSession(sessionId);
  return await untilRunning(app, sessionId);
}

/** The tabs the manager has stored for the session (what its next start reopens); null: the start page. */
export function storedLayout(
  app: RealManager,
  sessionId: number,
): TabLayout | null {
  return app.store.getSession(sessionId)?.tabs ?? null;
}
