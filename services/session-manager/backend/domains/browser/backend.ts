// The browser backend: identities, geo lookups and launches. `CamoufoxBackend`
// (`camoufox-backend.ts`) is the real one; tests use `FakeBackend`
// (`../../testing/fake-browser.ts`).
//
// Every session is its own Firefox process with its own profile directory. The
// browsers have no window: the web client watches and controls them through
// `BrowserHandle.remote`.

import type { InstallProgress } from '../../../lib/api/schemas.ts';
import type { TabLayout } from '../../lib/web-url.ts';
import type {
  GeneratedIdentity,
  GeoInfo,
  Identity,
  Location,
} from '../identity/types.ts';
import type { Remote } from './remote.ts';

/** A Playwright proxy setting, never with credentials (see `ProxyBridge`). */
export interface BrowserProxy {
  server: string;
}

export interface LaunchSpec {
  profileDir: string;
  /** The session's, for log lines. */
  name: string;
  identity: Identity;
  proxy: BrowserProxy;
  /** Its timezone, geolocation and WebRTC address: those of the proxy's exit IP. */
  location: Location;
  /** Reopened; none: the start page. */
  tabs: TabLayout;
  startPage: string;
  /** Told which tabs are open, to reopen them next time. */
  onLayout?: (layout: TabLayout) => void;
}

/** The automatic download of the browser: under way, or the issue that stopped it. */
export interface BrowserInstall {
  installing: boolean;
  error: string | null;
  /** How far it has come while it is under way, else null. */
  progress: InstallProgress | null;
}

export interface BrowserHandle {
  /** What the web client and the AI tools use to see and control the browser. */
  readonly remote: Remote;

  /**
   * Resolves when the session is over: the browser exited, or the user closed
   * its last window. The owner then calls `close`.
   */
  waitClosed(): Promise<void>;

  /** Close the browser; a no-op once it is gone. */
  close(): Promise<void>;
}

export interface BrowserBackend {
  /** The browser build this release works with. */
  readonly browserVersion: string;

  browserInstalled(): boolean;
  browserInstall(): BrowserInstall;

  /**
   * Install the browser if it is missing (see `browserInstall`), then prepare
   * the other slow first-use downloads; best effort.
   */
  warmUp(): Promise<void>;

  /**
   * Draw an identity of this OS whose signatures are not in `taken`. Rejects
   * with an `IdentityError` when none can be drawn.
   */
  createIdentity(
    os: string,
    taken: ReadonlySet<string>,
  ): Promise<GeneratedIdentity>;

  /** Rejects with a `GeoLookupError`. */
  lookupGeo(ip: string): Promise<GeoInfo>;

  launch(spec: LaunchSpec): Promise<BrowserHandle>;

  close(): Promise<void>;
}
