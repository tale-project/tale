// The application rules: the proxy pool and its health, exclusive proxy
// assignment, the session lifecycle, the secrets and the settings (`manager.ts`
// is the interface the HTTP routes, the live view and the MCP tools use).
//
// Everything runs on the event loop, so code between two awaits is atomic. Where
// an operation awaits and must not be joined by another, it holds a lock: one
// for the creation of sessions (names and fingerprint signatures are unique),
// one per session for its start, stop, rotation, restart and deletion.

import { rm, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { OS_CHOICES } from '../../../lib/api/schemas.ts';
import type {
  CheckStatus,
  Counts,
  ExportedProxy,
  ImportDuplicate,
  ImportLineError,
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
  SessionLocation,
  SessionRef,
  Settings,
} from '../../../lib/api/schemas.ts';
import { DuplicateProxyError, NameTakenError } from '../../db/store.ts';
import type {
  ProxyRecord,
  ProxyState,
  SecretRecord,
  SessionLink,
  SessionRecord,
  Store,
} from '../../db/store.ts';
import { abortable, isCancelled, sleep } from '../../lib/abort.ts';
import { KeyedMutex, Mutex } from '../../lib/mutex.ts';
import { DEFAULT_START_PAGE, EMPTY_LAYOUT, webUrl } from '../../lib/web-url.ts';
import type { TabLayout } from '../../lib/web-url.ts';
import type { BrowserBackend } from '../browser/backend.ts';
import type { Remote } from '../browser/remote.ts';
import {
  GeoLookupError,
  IdentityError,
  locationOf,
} from '../identity/types.ts';
import type { GeneratedIdentity, GeoInfo } from '../identity/types.ts';
import { ProxyChecks } from '../proxies/checks.ts';
import {
  parseProxy,
  parseProxyList,
  ProxyParseError,
} from '../proxies/parsing.ts';
import { ExitIpError, displayOf, identityKeyOf } from '../proxies/types.ts';
import type {
  ExitIpChecker,
  ProxyConfig,
  RunningBridge,
} from '../proxies/types.ts';
import {
  KIND_KEYS,
  KINDS,
  SecretError,
  cleanFields,
  cleanTitle,
  preview,
} from '../secrets/vault.ts';
import type { SecretField } from '../secrets/vault.ts';
import {
  MCP_ENABLED_KEY,
  START_PAGE_KEY,
  loadPreferences,
} from '../settings/preferences.ts';
import type { Preferences } from '../settings/preferences.ts';
import { rankCandidates } from './assignment.ts';
import type { Manager, Page, SecretScope } from './manager.ts';
import { nextAutoName, validateName } from './names.ts';
import * as refuse from './refusals.ts';
import { SessionRuntime } from './runtime.ts';
import type { Launch, SessionState } from './runtime.ts';

// A proxy's exit IP is looked at again while its session runs: it can change (a
// rotating proxy, a provider that reassigns it), and then the session's timezone
// and location no longer fit. The first look is early, to catch a proxy that
// changes with every connection.
export const FIRST_RECHECK_MS = 30_000;
export const RECHECK_EVERY_MS = 300_000;
export const WATCH_TICK_MS = 10_000;

export interface ManagerDeps {
  /** Holds `profiles/<session id>/`; the database is the caller's (`store`). */
  dataDir: string;
  /** The app's version, as `meta()` says. */
  version: string;
  store: Store;
  backend: BrowserBackend;
  checker: ExitIpChecker;
  /**
   * Accepted so the caller can pass its configuration along: the browser
   * backend applies it, the manager has no use for it.
   */
  blockWebrtc?: boolean;

  // Seams for tests.

  /** The wall clock (the time of an export). Default: the system's. */
  now?: () => Date;
  /** A clock that only goes forward, in milliseconds (when to look at an exit IP again). Default `performance.now`. */
  monotonic?: () => number;
  /** Waits between two rounds of the watch; resolves early when the signal aborts. Default: a timer. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Default 30 s. */
  shutdownTimeoutMs?: number;
  /** How many proxy checks run at once. Default 8. */
  checkConcurrency?: number;
  /** Starts the bridge for a proxy with credentials. Default: the real one. */
  startBridge?: (upstream: ProxyConfig) => Promise<RunningBridge>;
}

export function createManager(deps: ManagerDeps): Manager {
  return new SessionManager(deps);
}

const CHECK_STATUS: Readonly<Record<'true' | 'false' | 'null', CheckStatus>> = {
  true: 'ok',
  false: 'failed',
  null: 'unchecked',
};

function checkStatusOf(ok: boolean | null): CheckStatus {
  return CHECK_STATUS[`${ok}`];
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function isOsChoice(value: string): boolean {
  return OS_CHOICES.some((choice) => choice === value);
}

function exportedProxy(name: string, config: ProxyConfig): ExportedProxy {
  const username = config.username || undefined;
  const password = config.password || undefined;
  return {
    proxy_key: [
      config.scheme,
      config.host,
      String(config.port),
      username ?? '',
      password ?? '',
    ].join('|'),
    name,
    protocol: config.scheme,
    host: config.host,
    port: config.port,
    ...(username === undefined ? {} : { username }),
    ...(password === undefined ? {} : { password }),
    status: 'active',
    fallback_mode: 'none',
    expiry_warn_days: 7,
  };
}

class SessionManager implements Manager {
  readonly #version: string;
  readonly #store: Store;
  readonly #backend: BrowserBackend;
  readonly #runtime: SessionRuntime;
  readonly #checks: ProxyChecks;
  readonly #profilesRoot: string;
  readonly #now: () => Date;
  readonly #monotonic: () => number;
  readonly #sleep: (ms: number, signal?: AbortSignal) => Promise<void>;

  /**
   * Proxy id -> session id, while the proxy is checked for that session (an
   * assignment candidate, or a start pre-flight): meanwhile no other session
   * can get it, and it cannot be deleted. The database's unique index on
   * `sessions.proxy_id` is the final guarantee.
   */
  readonly #reserved = new Map<number, number>();
  /** Serializes creations: name uniqueness and fingerprint signature uniqueness. */
  readonly #createLock = new Mutex();
  readonly #sessionLocks = new KeyedMutex<number>();
  /** Running session id -> (monotonic) time when its proxy's exit IP is due to be looked at again. */
  readonly #ipDue = new Map<number, number>();

  constructor(deps: ManagerDeps) {
    this.#version = deps.version;
    this.#store = deps.store;
    this.#backend = deps.backend;
    this.#profilesRoot = join(resolve(deps.dataDir), 'profiles');
    this.#now = deps.now ?? (() => new Date());
    this.#monotonic = deps.monotonic ?? (() => performance.now());
    this.#sleep = deps.sleep ?? sleep;
    this.#runtime = new SessionRuntime(deps.backend, {
      shutdownTimeoutMs: deps.shutdownTimeoutMs,
      sleep: deps.sleep,
      startBridge: deps.startBridge,
    });
    this.#checks = new ProxyChecks(deps.store, deps.checker, {
      concurrency: deps.checkConcurrency,
    });
  }

  async close(): Promise<void> {
    await this.#runtime.shutdown();
    await this.#checks.aclose();
  }

  meta(): Meta {
    const sessions = this.#store.sessionLinks();
    const proxies = this.#store.proxyStates();
    const statuses = proxies.map((proxy) => this.#checkStatus(proxy));
    const installed = this.#backend.browserInstalled();
    const install = this.#backend.browserInstall();
    const counts: Counts = {
      proxies: proxies.length,
      freeProxies: this.#candidates().length,
      failedProxies: statuses.filter((status) => status === 'failed').length,
      checkingProxies: statuses.filter((status) => status === 'checking')
        .length,
      sessions: sessions.length,
      running: sessions.filter(
        (session) => this.#runtime.state(session.id).status === 'running',
      ).length,
      secrets: this.#store.countSecrets(),
    };
    return {
      version: this.#version,
      browserVersion: this.#backend.browserVersion,
      browserInstalled: installed,
      browserInstalling: install.installing,
      browserInstallProgress: install.installing ? install.progress : null,
      browserInstallError: installed ? null : install.error,
      osOptions: [...OS_CHOICES],
      secretKinds: KINDS.map((kind) => ({
        key: kind.key,
        label: kind.label,
        fields: kind.fields.map((field) => ({ ...field })),
      })),
      nextSessionName: nextAutoName(sessions.map((session) => session.name)),
      counts,
    };
  }

  // -- settings ----------------------------------------------------------------

  #preferences(): Preferences {
    return loadPreferences(this.#store.preferences());
  }

  settings(): Settings {
    const { startPage, mcpEnabled } = this.#preferences();
    return { startPage, defaultStartPage: DEFAULT_START_PAGE, mcpEnabled };
  }

  /** Only what is given changes; a blank start page means the default. */
  updateSettings(update: {
    startPage?: string | null;
    mcpEnabled?: boolean | null;
  }): Settings {
    const values: Record<string, unknown> = {};
    if (update.startPage !== undefined && update.startPage !== null) {
      const url =
        update.startPage.trim() === ''
          ? DEFAULT_START_PAGE
          : webUrl(update.startPage);
      if (url === null) throw refuse.invalidStartPage();
      values[START_PAGE_KEY] = url;
    }
    if (update.mcpEnabled !== undefined && update.mcpEnabled !== null) {
      values[MCP_ENABLED_KEY] = update.mcpEnabled;
    }
    if (Object.keys(values).length > 0) this.#store.setPreferences(values);
    return this.settings();
  }

  // -- secrets -----------------------------------------------------------------

  /** Newest first. For one session's `scope`, `includeGlobal` adds the secrets for every session. */
  listSecrets(
    options: {
      kind?: SecretKind | null;
      scope?: SecretScope;
      includeGlobal?: boolean;
    } = {},
  ): SecretSummary[] {
    const { kind = null, scope = 'all', includeGlobal = false } = options;
    if (kind !== null) this.#requireKind(kind);
    if (typeof scope === 'number') this.#requireSession(scope);
    const holders = this.#sessionLinksById();
    return this.#store
      .listSecrets({ kind, scope, includeGlobal })
      .map((record) => this.#secretSummary(record, holders));
  }

  getSecret(secretId: number): Secret {
    return this.#secretOut(this.#requireSecret(secretId));
  }

  /** `sessionId` null: for every session. */
  createSecret(input: {
    kind: SecretKind;
    title: string;
    fields: readonly SecretFieldIn[];
    sessionId?: number | null;
  }): Secret {
    const { kind, sessionId = null } = input;
    this.#requireKind(kind);
    if (sessionId !== null) this.#requireSession(sessionId);
    const { title, fields } = this.#cleanSecret(
      kind,
      input.title,
      input.fields,
    );
    return this.#secretOut(
      this.#store.addSecret(kind, title, sessionId, fields),
    );
  }

  /** Only what is given changes. The kind cannot. */
  updateSecret(
    secretId: number,
    update: {
      title?: string;
      fields?: readonly SecretFieldIn[];
      session?: 'keep' | 'global' | number;
    },
  ): Secret {
    const record = this.#requireSecret(secretId);
    const { session = 'keep' } = update;
    let sessionId = record.sessionId;
    if (session !== 'keep') {
      sessionId =
        session === 'global' ? null : this.#requireSession(session).id;
    }
    const { title, fields } = this.#cleanSecret(
      record.kind,
      update.title ?? record.title,
      update.fields ??
        record.fields.map(({ label, value, hidden }) => ({
          label,
          value,
          hidden,
        })),
    );
    this.#store.updateSecret(secretId, title, sessionId, fields);
    return this.getSecret(secretId);
  }

  deleteSecret(secretId: number): void {
    this.#requireSecret(secretId);
    this.#store.deleteSecret(secretId);
  }

  #requireKind(kind: string): void {
    if (!KIND_KEYS.some((key) => key === kind)) {
      throw refuse.invalidKind(KIND_KEYS);
    }
  }

  #requireSecret(secretId: number): SecretRecord {
    const record = this.#store.getSecret(secretId);
    if (record === null) throw refuse.secretNotFound(secretId);
    return record;
  }

  #cleanSecret(
    kind: SecretKind,
    title: string,
    fields: readonly SecretFieldIn[],
  ): { title: string; fields: SecretField[] } {
    try {
      return { title: cleanTitle(title), fields: cleanFields(kind, fields) };
    } catch (error) {
      if (error instanceof SecretError) {
        throw refuse.invalidSecret(error.message);
      }
      throw error;
    }
  }

  #secretSummary(
    record: SecretRecord,
    holders: ReadonlyMap<number, SessionLink>,
  ): SecretSummary {
    const holder =
      record.sessionId === null ? undefined : holders.get(record.sessionId);
    return {
      id: record.id,
      kind: record.kind,
      title: record.title,
      session: holder === undefined ? null : this.#ref(holder),
      preview: preview(record.fields),
      updatedAt: record.updatedAt,
    };
  }

  #secretOut(record: SecretRecord): Secret {
    return {
      ...this.#secretSummary(record, this.#sessionLinksById()),
      fields: record.fields.map(({ label, value, hidden }) => ({
        label,
        value,
        hidden,
      })),
      createdAt: record.createdAt,
    };
  }

  // -- proxies -----------------------------------------------------------------

  /** Newest first. */
  listProxies(page: Page = {}): Proxy[] {
    return this.#proxiesOut(this.#store.proxiesPage(page));
  }

  countProxies(): number {
    return this.#store.countProxies();
  }

  proxy(proxyId: number): Proxy {
    return this.#proxiesOut([this.#requireProxy(proxyId)])[0];
  }

  /** Adds the proxy and checks it in the background. */
  addProxy(text: string, options: { defaultScheme?: Scheme } = {}): Proxy {
    let config: ProxyConfig;
    try {
      config = parseProxy(text, { defaultScheme: options.defaultScheme });
    } catch (error) {
      if (error instanceof ProxyParseError) throw refuse.invalidProxy(error);
      throw error;
    }
    let record: ProxyRecord;
    try {
      record = this.#store.addProxy(config);
    } catch (error) {
      if (error instanceof DuplicateProxyError) {
        throw refuse.duplicateProxy(displayOf(config), error.existingId);
      }
      throw error;
    }
    this.#checks.queue([record.id]);
    return this.#proxyOut(record, null, null);
  }

  /** Adds every new proxy of the list and checks them in the background. */
  importProxies(
    text: string,
    options: { defaultScheme?: Scheme } = {},
  ): ImportResult {
    const parsed = parseProxyList(text, {
      defaultScheme: options.defaultScheme,
    });
    const results = this.#store.addProxies(
      parsed.proxies.map((line) => line.proxy),
    );
    const added: ProxyRecord[] = [];
    const duplicates: ImportDuplicate[] = [];
    // Identity key -> id, for the lines that repeat an earlier line of the input.
    const ids = new Map<string, number>();
    parsed.proxies.forEach((line, index) => {
      const result = results[index];
      const key = identityKeyOf(line.proxy);
      if (result.added) {
        ids.set(key, result.record.id);
        added.push(result.record);
      } else {
        ids.set(key, result.existingId);
        duplicates.push({
          line: line.lineno,
          display: displayOf(line.proxy),
          existingId: result.existingId,
        });
      }
    });
    this.#checks.queue(added.map((record) => record.id));
    for (const duplicate of parsed.duplicates) {
      const existingId = ids.get(identityKeyOf(duplicate.proxy));
      if (existingId === undefined) continue;
      duplicates.push({
        line: duplicate.lineno,
        display: displayOf(duplicate.proxy),
        existingId,
      });
    }
    duplicates.sort((a, b) => a.line - b.line);
    const errors: ImportLineError[] = parsed.errors.map((error) => ({
      line: error.lineno,
      input: error.maskedInput,
      message: error.message,
      code: error.code,
      params: { ...error.params },
    }));
    return {
      added: this.#proxiesOut(added),
      duplicates,
      errors,
      summary: `Added ${added.length}, ${plural(duplicates.length, 'duplicate')}, ${plural(errors.length, 'error')}`,
    };
  }

  deleteProxy(proxyId: number, options: { force?: boolean } = {}): void {
    const proxy = this.#requireProxy(proxyId);
    const holder = this.#holders().get(proxyId);
    if (holder !== undefined) {
      const display = displayOf(proxy.config);
      if (this.#reserved.has(proxyId) || this.#runtime.isActive(holder.id)) {
        throw refuse.proxyBusy(this.#ref(holder), display);
      }
      if (options.force !== true) {
        throw refuse.proxyInUse(this.#ref(holder), display);
      }
    }
    // Its session gets no proxy (the database unassigns it).
    this.#store.deleteProxy(proxyId);
  }

  /** Starts a background check (unless one is running). */
  checkProxy(proxyId: number): Proxy {
    const proxy = this.#requireProxy(proxyId);
    this.#checks.queue([proxyId]);
    return this.#proxiesOut([proxy])[0];
  }

  checkAllProxies(): Proxy[] {
    this.#checks.queue(this.#store.proxyStates().map((proxy) => proxy.id));
    return this.listProxies();
  }

  // -- sessions ----------------------------------------------------------------

  /** Newest first. */
  listSessions(page: Page = {}): Session[] {
    const sessions = this.#store.sessionsPage(page);
    const proxies = this.#proxiesById(sessions);
    return sessions.map((session) =>
      this.#sessionOut(session, this.#proxyIn(proxies, session)),
    );
  }

  countSessions(): number {
    return this.#store.countSessions();
  }

  session(sessionId: number): Session {
    const session = this.#requireSession(sessionId);
    return this.#sessionOut(session, this.#proxyOf(session));
  }

  /**
   * The proxies of the sessions, oldest session first, each named after its
   * session, as a sub2api proxy file. Unlike everything else the app returns,
   * it has the passwords.
   */
  exportProxies(): ProxyExport {
    const sessions = this.#store.sessionLinks();
    const proxies = this.#proxiesById(sessions);
    const exported = sessions.flatMap((session) => {
      const proxy = this.#proxyIn(proxies, session);
      return proxy === null ? [] : [exportedProxy(session.name, proxy.config)];
    });
    if (exported.length === 0) throw refuse.nothingToExport();
    return {
      exported_at: `${this.#now().toISOString().slice(0, 19)}Z`,
      proxies: exported,
      accounts: [],
    };
  }

  /** The live browser of a running session: its tabs, its picture, mouse and keyboard. */
  remote(sessionId: number): Remote {
    const session = this.#requireSession(sessionId);
    const handle = this.#runtime.handle(sessionId);
    if (
      handle === null ||
      this.#runtime.state(sessionId).status !== 'running'
    ) {
      throw refuse.sessionNotRunning(session.name, { startFirst: true });
    }
    return handle.remote;
  }

  /**
   * Creates the session and starts it: a proxy is assigned and the browser
   * launched in the background. A blank name means the next free number
   * ("0001", "0002", ...).
   */
  async createSession(
    input: { name?: string | null; os?: string } = {},
  ): Promise<Session> {
    const given = input.name;
    const requested =
      given !== undefined && given !== null && given.trim() !== ''
        ? validateName(given)
        : null;
    const os = input.os ?? 'random';
    if (!isOsChoice(os)) throw refuse.invalidOs(OS_CHOICES);
    return this.#createLock.run(async () => {
      if (requested !== null) this.#ensureNameFree(requested);
      this.#ensureBrowserInstalled();
      this.#firstCandidate(); // fail fast, before the slow identity draw
      let generated: GeneratedIdentity;
      try {
        generated = await this.#backend.createIdentity(
          os,
          this.#store.signatures(),
        );
      } catch (error) {
        if (error instanceof IdentityError) {
          throw refuse.fingerprintExhausted(error.message);
        }
        throw error;
      }
      // Again: names and proxies may have been taken while the identity was drawn.
      const first = this.#firstCandidate();
      const name = requested ?? nextAutoName(this.#store.sessionNames());
      let session: SessionRecord;
      try {
        session = this.#store.addSession(name, generated);
      } catch (error) {
        if (error instanceof NameTakenError) throw refuse.nameTaken(name);
        throw error;
      }
      this.#startWithAssignment(session.id, first);
      return this.session(session.id);
    });
  }

  /** Works in any status: the name is only a label. */
  renameSession(sessionId: number, name: string): Session {
    const session = this.#requireSession(sessionId);
    const valid = validateName(name);
    if (valid !== session.name) {
      try {
        this.#store.renameSession(sessionId, valid);
      } catch (error) {
        if (error instanceof NameTakenError) throw refuse.nameTaken(valid);
        throw error;
      }
    }
    return this.session(sessionId);
  }

  /**
   * A session without a proxy gets one assigned in the background. A session
   * with a proxy keeps it: its exit IP is checked first (502 when the proxy
   * does not work), and it must not be the exit IP of another active session
   * unless `force`.
   */
  startSession(
    sessionId: number,
    options: { force?: boolean } = {},
  ): Promise<Session> {
    return this.#sessionLocks.run(sessionId, async () => {
      const session = this.#requireSession(sessionId);
      if (this.#runtime.isBusy(sessionId)) {
        const state = this.#runtime.state(sessionId);
        if (state.status === 'starting' || state.status === 'running') {
          throw refuse.sessionRunning(session.name, state.status);
        }
        throw refuse.sessionBusy(session.name, state);
      }
      this.#ensureBrowserInstalled();
      const proxy = this.#proxyOf(session);
      if (proxy === null) {
        this.#startWithAssignment(sessionId, this.#firstCandidate());
      } else {
        const exitIp = await this.#preflight(session, proxy, {
          force: options.force === true,
        });
        this.#runtime.start(sessionId, {
          profileDir: this.#profileDir(sessionId),
          prepare: (signal) => this.#prepare(sessionId, proxy, exitIp, signal),
        });
      }
      return this.session(sessionId);
    });
  }

  stopSession(sessionId: number): Promise<Session> {
    return this.#sessionLocks.run(sessionId, async () => {
      this.#requireSession(sessionId);
      await this.#runtime.stop(sessionId);
      this.#release(sessionId); // in case the cancelled task never ran
      return this.session(sessionId);
    });
  }

  /**
   * Gives the session another working proxy in the background. A running
   * session is restarted with it; if no candidate works, the session keeps its
   * proxy.
   */
  rotateSession(sessionId: number): Promise<Session> {
    return this.#sessionLocks.run(sessionId, async () => {
      const session = this.#requireSession(sessionId);
      const state = this.#runtime.state(sessionId);
      if (this.#runtime.isBusy(sessionId) && state.status !== 'running') {
        throw refuse.sessionBusy(session.name, state);
      }
      const first = this.#firstCandidate();
      this.#reserved.set(first.id, sessionId);
      try {
        if (state.status === 'running') {
          this.#runtime.restart(sessionId, {
            profileDir: this.#profileDir(sessionId),
            prepare: (signal) =>
              this.#assignAndPrepare(sessionId, first.id, 'rotate', signal),
            assigning: true,
          });
        } else {
          this.#runtime.changeProxy(sessionId, (signal) =>
            this.#assign(sessionId, first.id, 'rotate', signal),
          );
        }
      } catch (error) {
        this.#unreserve(first.id, sessionId);
        throw error;
      }
      return this.session(sessionId);
    });
  }

  /**
   * Closes the running browser and opens it again, with the same proxy and the
   * same tabs. Its timezone and location are derived again then, for the
   * proxy's exit IP as it is now (it may have changed).
   */
  restartSession(sessionId: number): Promise<Session> {
    return this.#sessionLocks.run(sessionId, async () => {
      const session = this.#requireSession(sessionId);
      if (this.#runtime.state(sessionId).status !== 'running') {
        throw refuse.sessionNotRunning(session.name, { startFirst: false });
      }
      const proxy = this.#proxyOf(session);
      if (proxy === null) throw refuse.noProxy(session.name);
      // Before the browser is closed: if the proxy does not work, the session keeps running as it is.
      const exitIp = await this.#preflight(session, proxy, {
        force: true,
        failSession: false,
      });
      this.#runtime.restart(sessionId, {
        profileDir: this.#profileDir(sessionId),
        prepare: (signal) => this.#prepare(sessionId, proxy, exitIp, signal),
        assigning: false,
      });
      return this.session(sessionId);
    });
  }

  /**
   * Looks at the exit IP of the session's proxy now. `location.inSync` of the
   * result tells whether it is still the IP that the session's timezone and
   * location are for.
   */
  async checkSessionIp(sessionId: number): Promise<Session> {
    const session = this.#requireSession(sessionId);
    const proxy = this.#proxyOf(session);
    if (proxy === null) throw refuse.noProxy(session.name);
    try {
      await this.#checks.check(proxy.id);
    } catch (error) {
      if (error instanceof ExitIpError) {
        throw refuse.proxyUnreachable(session.name, error.message, proxy.id);
      }
      throw error;
    }
    return this.session(sessionId);
  }

  /**
   * One round of the watch over the exit IPs: looks again at the proxy of each
   * running session that is due (all of them with `force`). The result is kept
   * on the proxy, which is where `location.inSync` reads it.
   */
  async recheckRunning(options: { force?: boolean } = {}): Promise<void> {
    const now = this.#monotonic();
    for (const sessionId of this.#ipDue.keys()) {
      if (!this.#runtime.isActive(sessionId)) this.#ipDue.delete(sessionId);
    }
    const due = this.#store
      .sessionLinks()
      .filter(
        (session) =>
          session.proxyId !== null &&
          this.#runtime.state(session.id).status === 'running' &&
          (options.force === true || now >= (this.#ipDue.get(session.id) ?? 0)),
      );
    for (const session of due) {
      this.#ipDue.set(session.id, now + RECHECK_EVERY_MS);
    }
    const results = await Promise.allSettled(
      due.flatMap((session) =>
        session.proxyId === null ? [] : [this.#checks.check(session.proxyId)],
      ),
    );
    for (const result of results) {
      // A proxy that does not answer is kept as "not working" on the proxy, and shown: nothing to do here.
      if (
        result.status === 'rejected' &&
        !(result.reason instanceof ExitIpError) &&
        !isCancelled(result.reason)
      ) {
        console.warn('looking at an exit IP failed', result.reason);
      }
    }
  }

  /** Runs for as long as the app does; resolves when `signal` aborts. */
  async watchExitIps(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      await this.#sleep(WATCH_TICK_MS, signal);
      if (signal.aborted) return;
      try {
        await this.recheckRunning();
      } catch (error) {
        console.error(
          'looking at the exit IPs of the running sessions failed',
          error,
        );
      }
    }
  }

  deleteSession(sessionId: number): Promise<void> {
    return this.#sessionLocks.run(sessionId, async () => {
      this.#requireSession(sessionId);
      await this.#runtime.stopAndWait(sessionId);
      this.#release(sessionId);
      this.#store.deleteSession(sessionId); // its proxy becomes free
      this.#runtime.forget(sessionId);
      this.#ipDue.delete(sessionId);
      await this.#removeProfile(sessionId);
    });
  }

  // -- assignment --------------------------------------------------------------

  /**
   * Assignable proxies, best first: no session has (or is being assigned) them,
   * their last check did not fail, and their last known exit IP is not that of
   * a taken proxy. Working proxies come before unchecked ones, by id within
   * each group.
   */
  #candidates(): ProxyState[] {
    const taken = new Set<number>(this.#reserved.keys());
    for (const session of this.#store.sessionLinks()) {
      if (session.proxyId !== null) taken.add(session.proxyId);
    }
    return rankCandidates(this.#store.proxyStates(), taken);
  }

  #firstCandidate(): ProxyState {
    const [first] = this.#candidates();
    if (first === undefined) throw refuse.noFreeProxy();
    return first;
  }

  #startWithAssignment(sessionId: number, first: ProxyState): void {
    this.#reserved.set(first.id, sessionId);
    try {
      this.#runtime.start(sessionId, {
        profileDir: this.#profileDir(sessionId),
        prepare: (signal) =>
          this.#assignAndPrepare(sessionId, first.id, 'start', signal),
        assigning: true,
      });
    } catch (error) {
      this.#unreserve(first.id, sessionId);
      throw error;
    }
  }

  async #assignAndPrepare(
    sessionId: number,
    firstId: number,
    action: string,
    signal: AbortSignal,
  ): Promise<Launch> {
    const { proxy, exitIp } = await this.#assign(
      sessionId,
      firstId,
      action,
      signal,
    );
    return this.#prepare(sessionId, proxy, exitIp, signal);
  }

  /**
   * Checks candidates (`firstId` first, reserved by the caller) until one
   * works, and claims it for the session in place of its current proxy.
   * Returns it and its exit IP.
   */
  async #assign(
    sessionId: number,
    firstId: number,
    action: string,
    signal: AbortSignal,
  ): Promise<{ proxy: ProxyRecord; exitIp: string }> {
    let candidateId = firstId;
    let failed = 0;
    // Each proxy is tried once. A proxy that comes up again would only repeat
    // itself, and a loop that awaits nothing but memory would starve the app.
    const tried = new Set<number>();
    for (;;) {
      tried.add(candidateId);
      try {
        const result = await this.#checks.check(candidateId, { signal });
        // Stopped meanwhile: the proxy stays unclaimed (the check is still stored).
        signal.throwIfAborted();
        // Skipped, not failed, if a session has claimed a proxy with this exit IP meanwhile.
        if (
          !this.#store.claimedExitIps().has(result.ip) &&
          this.#store.claimProxy(sessionId, candidateId)
        ) {
          const proxy = this.#store.getProxy(candidateId);
          if (proxy === null) throw new Error('the claimed proxy is gone');
          return { proxy, exitIp: result.ip };
        }
      } catch (error) {
        if (!(error instanceof ExitIpError)) throw error;
        failed += 1; // stored on the proxy: it is no candidate any more
      } finally {
        this.#unreserve(candidateId, sessionId);
      }
      const next = this.#candidates().find(
        (candidate) => !tried.has(candidate.id),
      );
      if (next === undefined) throw refuse.noWorkingProxy(failed, action);
      candidateId = next.id;
      this.#reserved.set(candidateId, sessionId);
    }
  }

  /**
   * Checks the exit IP of the session's own proxy right before its start. A
   * start that cannot go on shows why in the session's row (`failSession`; not
   * for a session that is running).
   */
  async #preflight(
    session: SessionRecord,
    proxy: ProxyRecord,
    options: { force: boolean; failSession?: boolean },
  ): Promise<string> {
    this.#reserved.set(proxy.id, session.id); // cannot be deleted meanwhile
    let exitIp: string;
    try {
      exitIp = (await this.#checks.check(proxy.id)).ip;
    } catch (error) {
      if (!(error instanceof ExitIpError)) throw error;
      if (options.failSession !== false) {
        const shown = refuse.proxyUnreachableSessionError(
          error.message,
          proxy.id,
        );
        this.#runtime.fail(session.id, shown.code, shown.message, shown.extra);
      }
      throw refuse.proxyUnreachableAtStart(
        session.name,
        displayOf(proxy.config),
        error.message,
        proxy.id,
      );
    } finally {
      this.#unreserve(proxy.id, session.id);
    }
    const sharing = this.#store
      .sessionsOnExitIp(exitIp, session.id)
      .filter((other) => this.#runtime.isActive(other.id));
    if (sharing.length > 0 && !options.force) {
      throw refuse.ipInUse(
        exitIp,
        sharing.map((other) => this.#ref(other)),
      );
    }
    return exitIp;
  }

  /**
   * The place the session reports (timezone, geolocation) and its language,
   * for the proxy's exit IP.
   *
   * The place is derived once per exit IP and then kept, so the same IP always
   * gives the same place, also after the GeoIP database changed. A new exit IP
   * gives a new place. The language (a random pick among those of the country)
   * is kept for as long as the country is: it is drawn again for another
   * country.
   */
  async #prepare(
    sessionId: number,
    proxy: ProxyRecord,
    exitIp: string,
    signal: AbortSignal,
  ): Promise<Launch> {
    signal.throwIfAborted();
    const session = this.#requireSession(sessionId);
    let { identity, location } = session;
    if (location === null || location.ip !== exitIp || !identity.locale) {
      let geo: GeoInfo;
      try {
        geo = await abortable(this.#backend.lookupGeo(exitIp), signal);
      } catch (error) {
        if (error instanceof GeoLookupError) {
          throw refuse.unknownIpLocation(error.message);
        }
        throw error;
      }
      signal.throwIfAborted();
      if (location === null || location.ip !== exitIp) {
        if (location !== null && location.country !== geo.country) {
          // The same proxy now exits in another country.
          identity = { ...identity, locale: null };
        }
        location = locationOf(exitIp, geo);
      }
      if (!identity.locale) identity = { ...identity, locale: geo.locale };
    }
    this.#store.recordStart(sessionId, identity, location);
    this.#ipDue.set(sessionId, this.#monotonic() + FIRST_RECHECK_MS);
    return {
      name: session.name,
      identity,
      upstream: proxy.config,
      location,
      tabs: session.tabs ?? EMPTY_LAYOUT,
      startPage: this.#preferences().startPage,
      onLayout: (layout) => this.#saveTabs(sessionId, layout),
    };
  }

  #saveTabs(sessionId: number, layout: TabLayout): void {
    try {
      this.#store.saveTabs(sessionId, layout);
    } catch (error) {
      // The browser reports its tabs as it closes, possibly after the store did.
      console.warn(
        `could not remember the tabs of session ${sessionId}`,
        error,
      );
    }
  }

  #unreserve(proxyId: number, sessionId: number): void {
    if (this.#reserved.get(proxyId) === sessionId) {
      this.#reserved.delete(proxyId);
    }
  }

  /** Drops every reservation the session holds. */
  #release(sessionId: number): void {
    for (const [proxyId, holder] of this.#reserved) {
      if (holder === sessionId) this.#reserved.delete(proxyId);
    }
  }

  /** Proxy id -> the session that has the proxy or is being assigned it. */
  #holders(): Map<number, SessionLink> {
    const sessions = this.#store.sessionLinks();
    const byId = new Map(sessions.map((session) => [session.id, session]));
    const holders = new Map<number, SessionLink>();
    for (const [proxyId, sessionId] of this.#reserved) {
      const session = byId.get(sessionId);
      if (session !== undefined) holders.set(proxyId, session);
    }
    for (const session of sessions) {
      if (session.proxyId !== null) holders.set(session.proxyId, session);
    }
    return holders;
  }

  // -- helpers -----------------------------------------------------------------

  #requireProxy(proxyId: number): ProxyRecord {
    const proxy = this.#store.getProxy(proxyId);
    if (proxy === null) throw refuse.proxyNotFound(proxyId);
    return proxy;
  }

  #requireSession(sessionId: number): SessionRecord {
    const session = this.#store.getSession(sessionId);
    if (session === null) throw refuse.sessionNotFound(sessionId);
    return session;
  }

  #proxyOf(session: Pick<SessionLink, 'proxyId'>): ProxyRecord | null {
    return session.proxyId === null
      ? null
      : this.#store.getProxy(session.proxyId);
  }

  /** The proxies of these sessions, by id. */
  #proxiesById(
    sessions: readonly Pick<SessionLink, 'proxyId'>[],
  ): Map<number, ProxyRecord> {
    const ids = sessions.flatMap((session) =>
      session.proxyId === null ? [] : [session.proxyId],
    );
    return new Map(
      this.#store.getProxies(ids).map((proxy) => [proxy.id, proxy]),
    );
  }

  #proxyIn(
    proxies: ReadonlyMap<number, ProxyRecord>,
    session: Pick<SessionLink, 'proxyId'>,
  ): ProxyRecord | null {
    return session.proxyId === null
      ? null
      : (proxies.get(session.proxyId) ?? null);
  }

  #sessionLinksById(): Map<number, SessionLink> {
    return new Map(
      this.#store.sessionLinks().map((session) => [session.id, session]),
    );
  }

  #ensureNameFree(name: string): void {
    if (this.#store.sessionIdForName(name) !== null) {
      throw refuse.nameTaken(name);
    }
  }

  #ensureBrowserInstalled(): void {
    // The browser may be there already, but not the rest.
    if (this.#backend.browserInstall().installing) {
      throw refuse.browserInstalling();
    }
    if (!this.#backend.browserInstalled()) throw refuse.browserNotInstalled();
  }

  #profileDir(sessionId: number): string {
    return join(this.#profilesRoot, String(sessionId));
  }

  /** Removes the profile; never anything outside the profiles directory (a symlink is followed to where it points). */
  async #removeProfile(sessionId: number): Promise<void> {
    const root = await resolved(this.#profilesRoot);
    const profile = await resolved(this.#profileDir(sessionId));
    if (root === null || profile === null) return;
    const path = relative(root, profile);
    const inside =
      path !== '' &&
      path !== '..' &&
      !path.startsWith(`..${sep}`) &&
      !isAbsolute(path);
    if (!inside) return;
    try {
      await rm(profile, { recursive: true, force: true });
    } catch (error) {
      console.warn(
        `could not remove the profile of session ${sessionId}`,
        error,
      );
    }
  }

  #ref(session: Pick<SessionLink, 'id' | 'name'>): SessionRef {
    return {
      id: session.id,
      name: session.name,
      status: this.#runtime.state(session.id).status,
    };
  }

  #checkStatus(proxy: Pick<ProxyState, 'id' | 'ok'>): CheckStatus {
    return this.#checks.isChecking(proxy.id)
      ? 'checking'
      : checkStatusOf(proxy.ok);
  }

  #proxiesOut(proxies: readonly ProxyRecord[]): Proxy[] {
    const holders = this.#holders();
    // Exit IP -> the session that has a proxy with it: no other proxy with that exit IP is assigned.
    const ipHolders = new Map<string, SessionLink>();
    for (const held of this.#store.getProxies(holders.keys())) {
      const holder = holders.get(held.id);
      if (held.check.exitIp && holder !== undefined) {
        ipHolders.set(held.check.exitIp, holder);
      }
    }
    return proxies.map((proxy) =>
      this.#proxyOut(
        proxy,
        holders.get(proxy.id) ?? null,
        proxy.check.exitIp === null
          ? null
          : (ipHolders.get(proxy.check.exitIp) ?? null),
      ),
    );
  }

  #proxyOut(
    proxy: ProxyRecord,
    holder: SessionLink | null,
    ipHolder: SessionLink | null,
  ): Proxy {
    const { config, check } = proxy;
    return {
      id: proxy.id,
      scheme: config.scheme,
      host: config.host,
      port: config.port,
      username: config.username,
      hasPassword: Boolean(config.password),
      display: displayOf(config),
      createdAt: proxy.createdAt,
      check: {
        status: this.#checkStatus({ id: proxy.id, ok: check.ok }),
        ok: check.ok,
        exitIp: check.exitIp,
        country: check.country,
        latencyMs: check.latencyMs,
        checkedAt: check.checkedAt,
        error: check.error,
      },
      session: holder === null ? null : this.#ref(holder),
      sameIpAs:
        ipHolder !== null && holder === null ? this.#ref(ipHolder) : null,
    };
  }

  #sessionOut(session: SessionRecord, proxy: ProxyRecord | null): Session {
    const state: SessionState = this.#runtime.state(session.id);
    const { summary } = session;
    return {
      id: session.id,
      name: session.name,
      os: session.identity.os,
      status: state.status,
      activity: state.activity,
      error: state.error,
      errorCode: state.errorCode,
      errorExtra: state.errorExtra,
      proxy:
        proxy === null
          ? null
          : {
              id: proxy.id,
              display: displayOf(proxy.config),
              exitIp: proxy.check.exitIp,
              country: proxy.check.country,
              checkStatus: this.#checkStatus({
                id: proxy.id,
                ok: proxy.check.ok,
              }),
            },
      fingerprint: {
        userAgent: summary.userAgent,
        platform: summary.platform,
        screen: summary.screen,
        gpu: summary.gpu,
        locale: session.identity.locale,
        timezone: session.timezone,
      },
      location: this.#locationOut(session, proxy),
      createdAt: session.createdAt,
      lastStartedAt: session.lastStartedAt,
    };
  }

  #locationOut(
    session: SessionRecord,
    proxy: ProxyRecord | null,
  ): SessionLocation | null {
    const { location } = session;
    if (location === null) return null;
    // Known only while it runs, with a proxy whose last check worked.
    let inSync: boolean | null = null;
    if (
      proxy !== null &&
      proxy.check.ok === true &&
      this.#runtime.state(session.id).status === 'running'
    ) {
      inSync = proxy.check.exitIp === location.ip;
    }
    return {
      ip: location.ip,
      country: location.country,
      timezone: location.timezone,
      latitude: location.latitude,
      longitude: location.longitude,
      inSync,
    };
  }
}

/** The real path, or `null` when there is nothing there. */
async function resolved(path: string): Promise<string | null> {
  try {
    return await realpath(path);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}
