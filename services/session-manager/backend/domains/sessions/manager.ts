// The application rules as the HTTP routes and the MCP tools see them: the
// proxy pool and its health, exclusive proxy assignment, the session
// lifecycle, the windows of the sessions, the secrets and the settings.
// `SessionManager` (`service.ts`) implements it.
//
// Methods throw `AppError` (status, code, message) for everything a client can
// act on. Results are the API types of `lib/api/schemas.ts`.

import type {
  ImportResult,
  Meta,
  Proxy,
  ProxyExport,
  Scheme,
  Secret,
  SecretFieldIn,
  SecretKind,
  SecretSummary,
  Session,
  Settings,
} from '../../../lib/api/schemas.ts';
import type { Remote } from '../browser/remote.ts';

/**
 * A part of a list, newest (highest id) first. Without limits: the whole list.
 */
export interface Page {
  /** At most this many rows. */
  limit?: number;
  /** Only ids below this one: the next page. */
  before?: number;
  /** Only ids from this one up: the rows loaded so far, and the newer ones. */
  minId?: number;
}

/** Which secrets a list has: any, those for every session, or those of one session. */
export type SecretScope = 'all' | 'global' | number;

/**
 * The window of a browser that starts comes to the front once it is up: a
 * start the person asked for in the page. An AI assistant's start leaves the
 * screen as it is.
 */
export interface ShowOption {
  show?: boolean;
}

export interface Manager {
  meta(): Meta;

  // -- settings ----------------------------------------------------------------

  settings(): Settings;
  /** Only what is given changes; a blank start page means the default. */
  updateSettings(update: {
    startPage?: string | null;
    mcpEnabled?: boolean | null;
  }): Settings;

  // -- secrets -----------------------------------------------------------------

  /**
   * Newest first. For one session's scope, `includeGlobal` adds the secrets for
   * every session.
   */
  listSecrets(options?: {
    kind?: SecretKind | null;
    scope?: SecretScope;
    includeGlobal?: boolean;
  }): SecretSummary[];
  getSecret(secretId: number): Secret;
  /** `sessionId` null: for every session. */
  createSecret(input: {
    kind: SecretKind;
    title: string;
    fields: readonly SecretFieldIn[];
    sessionId?: number | null;
  }): Secret;
  /** Only what is given changes. The kind cannot. `session`: 'keep', 'global' or a session id. */
  updateSecret(
    secretId: number,
    update: {
      title?: string;
      fields?: readonly SecretFieldIn[];
      session?: 'keep' | 'global' | number;
    },
  ): Secret;
  deleteSecret(secretId: number): void;

  // -- proxies -----------------------------------------------------------------

  /** Newest first. */
  listProxies(page?: Page): Proxy[];
  countProxies(): number;
  proxy(proxyId: number): Proxy;
  /** Adds the proxy and checks it in the background. */
  addProxy(text: string, options?: { defaultScheme?: Scheme }): Proxy;
  /** Adds every new proxy of the list and checks them in the background. */
  importProxies(
    text: string,
    options?: { defaultScheme?: Scheme },
  ): ImportResult;
  deleteProxy(proxyId: number, options?: { force?: boolean }): void;
  /** Starts a background check (unless one is running). */
  checkProxy(proxyId: number): Proxy;
  checkAllProxies(): Proxy[];

  // -- sessions ----------------------------------------------------------------

  /** Newest first. */
  listSessions(page?: Page): Session[];
  countSessions(): number;
  session(sessionId: number): Session;

  /**
   * The proxies of the sessions, oldest session first, each named after its
   * session, as a sub2api proxy file. Unlike everything else the app returns,
   * it has the passwords.
   */
  exportProxies(): ProxyExport;

  /** The browser of a running session: its tabs, its pages, mouse and keyboard. */
  remote(sessionId: number): Remote;
  /**
   * Brings the window of a running session to the front of the screen, with
   * the tab the person last looked at in it.
   */
  showSession(sessionId: number): Promise<void>;
  /**
   * Types the text into the page of a running session, where its focus is:
   * the field the person last clicked in its window.
   */
  typeIntoSession(sessionId: number, text: string): Promise<void>;

  /**
   * Creates the session and starts it: a proxy is assigned and the browser
   * launched in the background. A blank name means the next free number
   * ("0001", "0002", …).
   */
  createSession(
    input?: {
      name?: string | null;
      os?: string;
    },
    options?: ShowOption,
  ): Promise<Session>;
  /** Works in any status: the name is only a label. */
  renameSession(sessionId: number, name: string): Session;
  /**
   * A session without a proxy gets one assigned in the background. A session
   * with a proxy keeps it: its exit IP is checked first (502 when the proxy
   * does not work), and it must not be the exit IP of another active session
   * unless `force`.
   */
  startSession(
    sessionId: number,
    options?: { force?: boolean } & ShowOption,
  ): Promise<Session>;
  stopSession(sessionId: number): Promise<Session>;
  /**
   * Gives the session another working proxy in the background. A running
   * session is restarted with it; if no candidate works, the session keeps its
   * proxy.
   */
  rotateSession(sessionId: number, options?: ShowOption): Promise<Session>;
  /**
   * Closes the running browser and opens it again, with the same proxy and the
   * same tabs. Its timezone and location are derived again then, for the
   * proxy's exit IP as it is now.
   */
  restartSession(sessionId: number, options?: ShowOption): Promise<Session>;
  /**
   * Looks at the exit IP of the session's proxy now. `location.inSync` of the
   * result tells whether it is still the IP that the session's timezone and
   * location are for.
   */
  checkSessionIp(sessionId: number): Promise<Session>;
  deleteSession(sessionId: number): Promise<void>;

  /**
   * One round of the watch over the exit IPs: looks again at the proxy of each
   * running session that is due (all of them with `force`).
   */
  recheckRunning(options?: { force?: boolean }): Promise<void>;
  /** Runs for as long as the app does; resolves when `signal` aborts. */
  watchExitIps(signal: AbortSignal): Promise<void>;

  /** Closes every browser (bounded) and stops the background work. */
  close(): Promise<void>;
}
