// The real `BrowserBackend`: identities, geo lookups and persistent-context
// launches of Camoufox through Playwright.
//
// Every session is its own Firefox process with its own profile directory, in a
// window of its own on this computer's screen; the AI tools drive it through
// `BrowserHandle.remote`. Without a window (`headless`: the tests that run a
// real browser) the browser is the same, and the remote picks the tab in front.
//
// camoufox-js reads `CAMOUFOX_INSTALL_DIR` when its modules are first loaded
// and the app sets it at startup, so camoufox-js and Playwright are imported
// when they are first needed, not at the top of a file. Everything outside
// (the identity and geo modules, Playwright, the install) comes in through
// `CamoufoxDeps`, so that the tests need no browser.

import { mkdir, stat } from 'node:fs/promises';
import { isIPv4, isIPv6 } from 'node:net';
import { join, resolve } from 'node:path';

import type { launchOptions as camoufoxLaunchOptions } from 'camoufox-js';

import type { InstallProgress } from '../../../lib/api/schemas.ts';
import { isRecord } from '../../../lib/is-record.ts';
import { describeError } from '../../lib/error-text.ts';
import type { TabLayout } from '../../lib/web-url.ts';
import { identityLaunchOptions } from '../identity/launch-options.ts';
import type {
  GeneratedIdentity,
  GeoInfo,
  Location,
} from '../identity/types.ts';
import type { BrowserBackend, BrowserInstall, LaunchSpec } from './backend.ts';
import {
  CamoufoxSession,
  killProcess,
  listProcesses,
} from './camoufox-session.ts';
import type { RemoteLifecycle, SessionContext } from './camoufox-session.ts';
import { browserEnvironment } from './environment.ts';
import { browserBuild, fetchBrowser, isInstalled } from './install.ts';
import {
  PAGES_IN_TABS,
  boundInputWaits,
  clearStaleScripts,
  openPagesInTabs,
} from './juggler.ts';
import type { InputWaits, PagesInTabs } from './juggler.ts';
import type { PwContext } from './playwright-remote.ts';
import { activateWindow } from './window.ts';

/** What `launchOptions` of camoufox-js is given. */
export type LaunchArgs = Parameters<typeof camoufoxLaunchOptions>[0];
/** What it answers: the options of Playwright's `launchPersistentContext`. */
export type PlaywrightOptions = Record<string, unknown>;

type ConfigValue = string | number | boolean;

export const LAUNCH_PREFS: Readonly<Record<string, ConfigValue>> = {
  // Firefox shows a one-off "restore session" bar on a profile's 2nd start,
  // changing innerHeight.
  'browser.startup.couldRestoreSession.count': -1,
  // CRITICAL: without it an RTCPeerConnection created in an
  // about:blank/srcdoc/blob:/data: iframe or a popup sends real UDP STUN
  // packets around the proxy and leaks the real IP.
  'media.peerconnection.ice.proxy_only': true,
  // Firefox keeps localhost, 127.0.0.1 and ::1 out of the proxy unless told
  // otherwise: a page (or an assistant that navigates) could reach every
  // service of this computer directly, the manager's own API included.
  // Everything a session loads goes through the session's proxy, loopback
  // addresses too (they usually do not connect there).
  'network.proxy.allow_hijacking_localhost': true,
};

/** Camoufox's database of IP locations, in the install directory. */
const GEOIP_FILE = 'GeoLite2-City.mmdb';
/** The database is downloaded again when it is older than this. */
const GEOIP_MAX_AGE_MS = 8 * 24 * 60 * 60 * 1000;

export interface RemoteOptions {
  startPage: string;
  onLayout?: (layout: TabLayout) => void;
  /** The browser has a window where a person uses it (see `PlaywrightRemote`). */
  windowed: boolean;
}

/** Everything the backend uses that is outside this file. */
export interface CamoufoxDeps {
  createIdentity: (
    os: string,
    taken: ReadonlySet<string>,
  ) => Promise<GeneratedIdentity>;
  lookupGeo: (ip: string) => Promise<GeoInfo>;
  /** Download the GeoIP database if it is missing or old. */
  warmUpGeo: () => Promise<void>;
  /** `launchOptions` of camoufox-js. */
  launchOptions: (options: LaunchArgs) => Promise<PlaywrightOptions>;
  /** `launchPersistentContext` of Playwright's `firefox`. */
  launchPersistentContext: (
    profileDir: string,
    options: PlaywrightOptions,
  ) => Promise<SessionContext>;
  createRemote: (
    context: SessionContext,
    options: RemoteOptions,
  ) => RemoteLifecycle | Promise<RemoteLifecycle>;
  /**
   * `camoufox-js fetch`: null once installed, else the issue. Rejects when
   * aborted. `onProgress` is told how far it has come.
   */
  installBrowser: (
    signal: AbortSignal,
    onProgress: (progress: InstallProgress) => void,
  ) => Promise<string | null>;
  isInstalled: () => boolean;
  /**
   * Makes the installed build stop waiting for ever for a mouse event that a
   * page does not take (`juggler.ts`).
   */
  boundInputWaits: () => Promise<InputWaits>;
  /**
   * Makes the installed build open the pages Playwright asks for as tabs of
   * the window, not as windows of their own (`juggler.ts`).
   */
  openPagesInTabs: () => Promise<PagesInTabs>;
  /**
   * Deletes the compiled copies of the build's scripts that the profile keeps,
   * unless they were made from the build it starts with (`juggler.ts`).
   */
  clearStaleScripts: (profileDir: string) => Promise<void>;
  /** The Camoufox build this release works with. */
  browserVersion: () => string;
  makeDirectory: (path: string) => Promise<void>;
  /** The output of `ps -axo pid=,command=`: how a browser that will not close is found. */
  listProcesses: () => Promise<string>;
  killProcess: (pid: number) => void;
  /** Brings the windows of the browser with this process id to the front (`window.ts`). */
  activateWindow: (pid: number) => Promise<boolean>;
}

// -- what the launch asks Camoufox for ----------------------------------------------

/**
 * What `geoip=<exit ip>` would set, but from the session's pinned location
 * instead of from the GeoIP database as it is today: the timezone and
 * geolocation, and the exit IP as the WebRTC address (the browser stays off IPv6
 * then, as with geoip). The language comes with the identity.
 */
export function locationConfig(
  location: Location,
  blockWebrtc: boolean,
): {
  config: Record<string, ConfigValue>;
  prefs: Record<string, ConfigValue>;
} {
  const config: Record<string, ConfigValue> = {
    timezone: location.timezone,
    'geolocation:latitude': location.latitude,
    'geolocation:longitude': location.longitude,
  };
  const prefs: Record<string, ConfigValue> = {
    ...LAUNCH_PREFS,
    // Camoufox 152 saves the zone it was configured with in the profile
    // (`prefs.js`) and a later launch's `timezone` does not replace it: a
    // session rotated to a proxy in another zone would keep its first clock.
    'roverfox.s.timezone_0': location.timezone,
  };
  if (!blockWebrtc) {
    if (isIPv4(location.ip)) {
      config['webrtc:ipv4'] = location.ip;
      prefs['network.dns.disableIPv6'] = true;
    } else if (isIPv6(location.ip)) {
      config['webrtc:ipv6'] = location.ip;
    } else {
      throw new Error(`${location.ip} is not an IP address`);
    }
  }
  return { config, prefs };
}

/**
 * The `launchOptions` arguments of a launch: the identity, the proxy, the place,
 * and a window unless `headless`.
 */
export function launchArgs(
  spec: LaunchSpec,
  blockWebrtc: boolean,
  env: Readonly<Record<string, string | undefined>> = process.env,
  headless = false,
): LaunchArgs {
  const identity = identityLaunchOptions(spec.identity);
  // The identity pins what Camoufox would draw at random: keep it.
  const pinned: unknown = identity.config;
  const { config, prefs } = locationConfig(spec.location, blockWebrtc);
  return {
    ...identity,
    // The person uses the browser in its own window.
    headless,
    proxy: spec.proxy,
    config: { ...(isRecord(pinned) ? pinned : {}), ...config },
    block_webrtc: blockWebrtc,
    // The tabs it reopens, and the ones the tools open, in its window.
    firefox_user_prefs: headless ? prefs : { ...prefs, [PAGES_IN_TABS]: true },
    // camoufox-js would hand the browser the whole environment of the app.
    env: browserEnvironment(env),
  };
}

// -- the defaults of CamoufoxDeps ---------------------------------------------------------

async function modifiedAt(file: string): Promise<number | null> {
  try {
    return (await stat(file)).mtimeMs;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/** Downloads the GeoIP database unless it is there and not old. */
export async function refreshGeoDatabase(options: {
  file: string;
  download: () => Promise<void>;
  now?: () => number;
}): Promise<boolean> {
  const modified = await modifiedAt(options.file);
  const now = options.now ?? Date.now;
  if (modified !== null && now() - modified < GEOIP_MAX_AGE_MS) return false;
  await options.download();
  return true;
}

async function warmUpGeoDatabase(): Promise<void> {
  const [{ INSTALL_DIR }, { downloadMMDB }] = await Promise.all([
    import('camoufox-js/dist/pkgman.js'),
    import('camoufox-js/dist/locale.js'),
  ]);
  await refreshGeoDatabase({
    file: join(INSTALL_DIR.toString(), GEOIP_FILE),
    download: downloadMMDB,
  });
}

function isPlaywrightContext(
  context: SessionContext,
): context is SessionContext & PwContext {
  return (
    'newPage' in context &&
    typeof context.newPage === 'function' &&
    'off' in context &&
    typeof context.off === 'function'
  );
}

export async function createPlaywrightRemote(
  context: SessionContext,
  options: RemoteOptions,
): Promise<RemoteLifecycle> {
  const { PlaywrightRemote } = await import('./playwright-remote.ts');
  if (!isPlaywrightContext(context)) {
    throw new Error(
      'the browser context cannot be driven by a PlaywrightRemote',
    );
  }
  return new PlaywrightRemote(context, options);
}

/**
 * The installed build's `omni.ja`, or null when there is no build that
 * camoufox-js launches: none, or an older one (a launch installs the pinned
 * build first).
 */
async function installedOmniJa(): Promise<string | null> {
  const { getPath } = await import('camoufox-js/dist/pkgman.js');
  try {
    return getPath('omni.ja');
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === 'CamoufoxNotInstalled' ||
        error.name === 'UnsupportedVersion')
    ) {
      return null;
    }
    throw error;
  }
}

/** The deps the app runs with, each loaded when it is first used. */
const DEFAULT_DEPS: CamoufoxDeps = {
  async createIdentity(os, taken) {
    const { createIdentity } = await import('../identity/fingerprints.ts');
    return createIdentity(os, taken);
  },
  async lookupGeo(ip) {
    const { lookup } = await import('../identity/geo.ts');
    return lookup(ip);
  },
  warmUpGeo: warmUpGeoDatabase,
  async launchOptions(options) {
    const { launchOptions } = await import('camoufox-js');
    return launchOptions(options);
  },
  async launchPersistentContext(profileDir, options) {
    // `NewBrowser` launches without Playwright's default viewport when
    // Camoufox pins the window size: the 1280x720 default would be asked of a
    // window that cannot have it, and the page would report it instead of the
    // size the identity says.
    const [{ NewBrowser }, { firefox }] = await Promise.all([
      import('camoufox-js'),
      import('playwright-core'),
    ]);
    return NewBrowser(firefox, options.headless === true, options, profileDir);
  },
  createRemote: createPlaywrightRemote,
  installBrowser: (signal, onProgress) => fetchBrowser({ signal, onProgress }),
  isInstalled: () => isInstalled(),
  async boundInputWaits() {
    const omniJa = await installedOmniJa();
    return omniJa === null ? 'missing' : boundInputWaits(omniJa);
  },
  async openPagesInTabs() {
    const omniJa = await installedOmniJa();
    return omniJa === null ? 'missing' : openPagesInTabs(omniJa);
  },
  async clearStaleScripts(profileDir) {
    const omniJa = await installedOmniJa();
    if (omniJa !== null) await clearStaleScripts({ omniJa, profileDir });
  },
  browserVersion: browserBuild,
  async makeDirectory(path) {
    await mkdir(path, { recursive: true });
  },
  listProcesses,
  killProcess,
  activateWindow,
};

function noWindow(): Promise<boolean> {
  return Promise.resolve(false);
}

function resolveDeps(overrides: Partial<CamoufoxDeps> = {}): CamoufoxDeps {
  return {
    createIdentity: overrides.createIdentity ?? DEFAULT_DEPS.createIdentity,
    lookupGeo: overrides.lookupGeo ?? DEFAULT_DEPS.lookupGeo,
    warmUpGeo: overrides.warmUpGeo ?? DEFAULT_DEPS.warmUpGeo,
    launchOptions: overrides.launchOptions ?? DEFAULT_DEPS.launchOptions,
    launchPersistentContext:
      overrides.launchPersistentContext ?? DEFAULT_DEPS.launchPersistentContext,
    createRemote: overrides.createRemote ?? DEFAULT_DEPS.createRemote,
    installBrowser: overrides.installBrowser ?? DEFAULT_DEPS.installBrowser,
    isInstalled: overrides.isInstalled ?? DEFAULT_DEPS.isInstalled,
    boundInputWaits: overrides.boundInputWaits ?? DEFAULT_DEPS.boundInputWaits,
    openPagesInTabs: overrides.openPagesInTabs ?? DEFAULT_DEPS.openPagesInTabs,
    clearStaleScripts:
      overrides.clearStaleScripts ?? DEFAULT_DEPS.clearStaleScripts,
    browserVersion: overrides.browserVersion ?? DEFAULT_DEPS.browserVersion,
    makeDirectory: overrides.makeDirectory ?? DEFAULT_DEPS.makeDirectory,
    listProcesses: overrides.listProcesses ?? DEFAULT_DEPS.listProcesses,
    killProcess: overrides.killProcess ?? DEFAULT_DEPS.killProcess,
    activateWindow: overrides.activateWindow ?? DEFAULT_DEPS.activateWindow,
  };
}

export class CamoufoxBackend implements BrowserBackend {
  readonly #blockWebrtc: boolean;
  readonly #headless: boolean;
  readonly #deps: CamoufoxDeps;
  /** Aborts when the backend closes: an install under way stops. */
  readonly #shutdown = new AbortController();
  readonly #sessions = new Set<CamoufoxSession>();
  #install: BrowserInstall = { installing: false, error: null, progress: null };
  #warmingUp: Promise<void> | null = null;
  #inputWaits: Promise<void> | null = null;
  #version: string | null = null;

  constructor(options: {
    blockWebrtc: boolean;
    /** No window: the tests that run a real browser. Default false. */
    headless?: boolean;
    deps?: Partial<CamoufoxDeps>;
  }) {
    this.#blockWebrtc = options.blockWebrtc;
    this.#headless = options.headless ?? false;
    this.#deps = resolveDeps(options.deps);
  }

  /** The Camoufox build this release of camoufox-js installs and launches. */
  get browserVersion(): string {
    this.#version ??= this.#deps.browserVersion();
    return this.#version;
  }

  browserInstalled(): boolean {
    return this.#deps.isInstalled();
  }

  browserInstall(): BrowserInstall {
    return this.#install;
  }

  /**
   * Installs the browser if it is missing (see `browserInstall`), then does
   * what else would make the first session slow: the GeoIP database. An
   * install that fails is `browserInstall().error`, not a rejection, and the
   * rest is best effort (offline hosts still work once the data is present).
   */
  warmUp(): Promise<void> {
    this.#warmingUp ??= this.#warmUp().finally(() => {
      this.#warmingUp = null;
    });
    return this.#warmingUp;
  }

  async #warmUp(): Promise<void> {
    const { signal } = this.#shutdown;
    if (!this.#deps.isInstalled()) {
      this.#install = { installing: true, error: null, progress: null };
      let error: string | null = null;
      try {
        error = await this.#deps.installBrowser(signal, (progress) => {
          if (this.#install.installing) {
            this.#install = { ...this.#install, progress };
          }
        });
      } catch (cause) {
        // Not an issue to show: the app is shutting down.
        if (!signal.aborted) {
          console.error('Installing the Camoufox browser failed', cause);
          error = describeError(cause);
        }
      } finally {
        // Also when cancelled at shutdown.
        this.#install = { installing: false, error, progress: null };
      }
    }
    if (signal.aborted) return;
    await this.#boundInputWaits();
    try {
      await this.#deps.warmUpGeo();
    } catch (error) {
      console.warn('Camoufox warm-up failed', error);
    }
  }

  /**
   * Changes the installed build (see `juggler.ts`): its waits for a mouse
   * event that a page does not take end, and the pages Playwright asks for
   * open as tabs of the window. Once, before the first browser starts, and
   * again while there is no build to change or it could not be changed. Never
   * rejects: a build that is not changed starts as it is.
   */
  #boundInputWaits(): Promise<void> {
    this.#inputWaits ??= this.#changeBuild();
    return this.#inputWaits;
  }

  async #changeBuild(): Promise<void> {
    let outcome: InputWaits;
    try {
      outcome = await this.#deps.boundInputWaits();
    } catch (error) {
      // Tried again at the next launch: a full disk, say, may have room then.
      this.#inputWaits = null;
      console.warn(
        'Could not change the Camoufox browser: a mouse event that a page does not take can stop its mouse until the session restarts',
        error,
      );
      return;
    }
    if (outcome === 'missing') {
      this.#inputWaits = null;
      return;
    } else if (outcome === 'changed') {
      console.info(
        'Changed the Camoufox browser so that a mouse event that a page does not take no longer stops its mouse for good',
      );
    } else if (outcome === 'unknown') {
      console.warn(
        'Left the Camoufox browser as it is: it is not the build the app knows how to change, and a mouse event that a page does not take can stop its mouse until the session restarts',
      );
    }
    await this.#openPagesInTabs();
  }

  async #openPagesInTabs(): Promise<void> {
    let outcome: PagesInTabs;
    try {
      outcome = await this.#deps.openPagesInTabs();
    } catch (error) {
      this.#inputWaits = null;
      console.warn(
        'Could not change the Camoufox browser: the tabs a session reopens, and the ones the AI tools open, come up in windows of their own',
        error,
      );
      return;
    }
    if (outcome === 'missing') {
      this.#inputWaits = null;
    } else if (outcome === 'changed') {
      console.info(
        'Changed the Camoufox browser so that the tabs a session reopens, and the ones the AI tools open, come up in its window',
      );
    } else if (outcome === 'unknown') {
      console.warn(
        'Left the Camoufox browser as it is: it is not the build the app knows how to change, and the tabs a session reopens, and the ones the AI tools open, come up in windows of their own',
      );
    }
  }

  /** Before a browser starts (see `juggler.ts`); never rejects. */
  async #clearStaleScripts(profileDir: string): Promise<void> {
    try {
      await this.#deps.clearStaleScripts(profileDir);
    } catch (error) {
      console.warn(
        'Could not delete the old compiled scripts of a profile: its browser may run them, and a mouse event that a page does not take can stop its mouse until the session restarts',
        error,
      );
    }
  }

  createIdentity(
    os: string,
    taken: ReadonlySet<string>,
  ): Promise<GeneratedIdentity> {
    return this.#deps.createIdentity(os, taken);
  }

  lookupGeo(ip: string): Promise<GeoInfo> {
    return this.#deps.lookupGeo(ip);
  }

  /**
   * Starts the browser of a session: its profile, its identity, its proxy and
   * its place, with the tabs it had (or the start page). A browser that
   * started but cannot be driven is closed again.
   */
  async launch(spec: LaunchSpec): Promise<CamoufoxSession> {
    this.#assertOpen();
    const profileDir = resolve(spec.profileDir);
    await this.#deps.makeDirectory(profileDir);
    // The result holds a copy of the environment: never store or log it.
    const options = await this.#deps.launchOptions(
      launchArgs(spec, this.#blockWebrtc, process.env, this.#headless),
    );
    // After `launchOptions`, which installs the build camoufox-js pins when
    // another one is there.
    await this.#boundInputWaits();
    await this.#clearStaleScripts(profileDir);
    this.#assertOpen();
    const context = await this.#deps.launchPersistentContext(profileDir, {
      ...options,
      // Camoufox turns a proxy URL into its origin, which is "null" for
      // socks5://.
      proxy: spec.proxy,
      // The app closes the browsers itself when it stops (`close()`). With
      // Playwright's own handlers both would close them at once ("graceful
      // close failed; killing the browser" on every Ctrl+C), and its SIGINT
      // handler exits the process before the app has finished stopping.
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
      // A download is a file Playwright writes to the temporary folder until
      // the session ends: a page could fill the disk with them. Sessions
      // have no use for downloads (the old app refused them too).
      acceptDownloads: false,
    });
    let session: CamoufoxSession;
    try {
      this.#assertOpen();
      // The `geolocation:*` values of the config are not delivered by this
      // Camoufox build: the pages are given the position of the exit IP, never
      // this computer's.
      await context.setGeolocation({
        latitude: spec.location.latitude,
        longitude: spec.location.longitude,
      });
      const remote = await this.#deps.createRemote(context, {
        startPage: spec.startPage,
        onLayout: spec.onLayout,
        windowed: !this.#headless,
      });
      session = new CamoufoxSession(context, remote, {
        profileDir,
        listProcesses: this.#deps.listProcesses,
        kill: this.#deps.killProcess,
        // Without a window there is nothing to bring to the front.
        activate: this.#headless ? noWindow : this.#deps.activateWindow,
      });
    } catch (error) {
      await this.#closeQuietly(spec.name, context.close());
      throw error;
    }
    // From here on `close()` of the backend closes it too.
    this.#sessions.add(session);
    void session.contextClosed.then(() => this.#sessions.delete(session));
    try {
      await session.remote.restore(
        spec.tabs.urls.length > 0 ? spec.tabs.urls : [spec.startPage],
        spec.tabs.active,
      );
      this.#assertOpen();
    } catch (error) {
      await this.#closeQuietly(spec.name, session.close());
      throw error;
    }
    return session;
  }

  /** Closes the browsers that are still open, and stops an install under way. */
  async close(): Promise<void> {
    this.#shutdown.abort();
    const results = await Promise.allSettled(
      [...this.#sessions].map((session) => session.close()),
    );
    for (const result of results) {
      if (result.status === 'rejected') {
        console.error('Could not close a browser', result.reason);
      }
    }
  }

  #assertOpen(): void {
    if (this.#shutdown.signal.aborted) {
      throw new Error('The browser backend is closed.');
    }
  }

  async #closeQuietly(name: string, closing: Promise<void>): Promise<void> {
    try {
      await closing;
    } catch (error) {
      // The launch failed first: that is the error to report.
      console.warn(
        `could not close the browser of ${name}: ${describeError(error)}`,
      );
    }
  }
}
