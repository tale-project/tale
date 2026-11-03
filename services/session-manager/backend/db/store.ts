// SQLite persistence (`bun:sqlite`: one connection, used from the event loop
// only, so every call is atomic with respect to the rest of the app). The
// database is this app's own: it is marked with an `application_id`, and a
// database any other program made is refused, untouched.
//
// Two rules the schema enforces, whatever the callers do:
//   * a proxy belongs to at most one session (a unique index on
//     `sessions.proxy_id`),
//   * a session name is unique ignoring case (`name_key`).
// Deleting a proxy unassigns its session (`ON DELETE SET NULL`), deleting a
// session deletes its secrets (`ON DELETE CASCADE`).

import { Database, SQLiteError } from 'bun:sqlite';
import type { Changes } from 'bun:sqlite';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { z } from 'zod';

import {
  MAX_ID,
  schemeSchema,
  secretFieldSchema,
  secretKindSchema,
} from '../../lib/api/schemas.ts';
import type { SecretKind } from '../../lib/api/schemas.ts';
import { identityFromJson, identityToJson } from '../domains/identity/types.ts';
import type {
  GeneratedIdentity,
  Identity,
  Location,
  Summary,
} from '../domains/identity/types.ts';
import { locationFromJson, locationToJson } from '../domains/identity/types.ts';
import { identityKeyOf } from '../domains/proxies/types.ts';
import type { ExitIp, ProxyConfig } from '../domains/proxies/types.ts';
import type { SecretField } from '../domains/secrets/vault.ts';
import type { Page, SecretScope } from '../domains/sessions/manager.ts';
import { casefold } from '../lib/casefold.ts';
import { errorText } from '../lib/error-text.ts';
import { layoutFromJson, layoutToJson } from '../lib/web-url.ts';
import type { TabLayout } from '../lib/web-url.ts';

export { MAX_ID };

/**
 * How long a statement waits for another process that holds the database (a
 * backup, a second manager on the same directory) before it fails. Without it
 * every request fails at once, reads too.
 */
export const BUSY_TIMEOUT_MS = 5000;

/** Marks the database as this app's ("SMGR"): `PRAGMA application_id`. */
export const APPLICATION_ID = 0x534d4752;
/** `PRAGMA user_version`. The first and only schema so far. */
export const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE proxies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scheme TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    username TEXT,
    password TEXT,
    identity_key TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    check_ok INTEGER,
    exit_ip TEXT,
    country TEXT,
    latency_ms INTEGER,
    checked_at TEXT,
    check_error TEXT
);
CREATE TABLE sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL UNIQUE,
    proxy_id INTEGER REFERENCES proxies(id) ON DELETE SET NULL,
    identity TEXT NOT NULL,
    visible_signature TEXT NOT NULL UNIQUE,
    full_signature TEXT NOT NULL UNIQUE,
    summary TEXT NOT NULL,
    timezone TEXT,
    created_at TEXT NOT NULL,
    last_started_at TEXT,
    tabs TEXT,  -- JSON TabLayout: the tabs the browser had open when it ended; NULL: start from the start page
    location TEXT  -- JSON Location: the place the session reports, for the exit IP it started with
);
-- A proxy belongs to at most one session.
CREATE UNIQUE INDEX sessions_proxy_id ON sessions (proxy_id) WHERE proxy_id IS NOT NULL;
CREATE TABLE preferences (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL  -- JSON
);
CREATE TABLE secrets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,  -- NULL: for every session
    fields TEXT NOT NULL,  -- JSON list of {label, value, hidden}
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX secrets_session_id ON secrets (session_id);
`;

// -- what the rows become ------------------------------------------------------

export interface ProxyCheck {
  /** `null`: never checked. */
  ok: boolean | null;
  /** From the last successful check. */
  exitIp: string | null;
  country: string | null;
  latencyMs: number | null;
  checkedAt: string | null;
  error: string | null;
}

export interface ProxyRecord {
  id: number;
  config: ProxyConfig;
  createdAt: string;
  check: ProxyCheck;
}

/** The part of a proxy that assignment looks at; cheaper than a `ProxyRecord`. */
export interface ProxyState {
  id: number;
  ok: boolean | null;
  exitIp: string | null;
}

export interface SessionRecord {
  id: number;
  name: string;
  proxyId: number | null;
  identity: Identity;
  summary: Summary;
  /** Of the exit IP at the last start. */
  timezone: string | null;
  createdAt: string;
  lastStartedAt: string | null;
  /** `null`: it opens the start page. */
  tabs: TabLayout | null;
  /** `null`: derived from the exit IP at the next start. */
  location: Location | null;
}

/** What most questions about a session need: no identity to parse. */
export interface SessionLink {
  id: number;
  name: string;
  proxyId: number | null;
}

export interface SecretRecord {
  id: number;
  kind: SecretKind;
  title: string;
  /** `null`: for every session. */
  sessionId: number | null;
  fields: readonly SecretField[];
  createdAt: string;
  updatedAt: string;
}

export type AddProxyResult =
  | { added: true; record: ProxyRecord }
  | { added: false; existingId: number };

/** Another proxy has the same identity key (`identityKeyOf`). */
export class DuplicateProxyError extends Error {
  readonly existingId: number;

  constructor(existingId: number) {
    super(`proxy already exists (id ${existingId})`);
    this.name = 'DuplicateProxyError';
    this.existingId = existingId;
  }
}

/** Another session has the name, ignoring case. */
export class NameTakenError extends Error {
  constructor() {
    super('a session with this name already exists');
    this.name = 'NameTakenError';
  }
}

/**
 * The file is not a database this app can work with. The message names the
 * cause and what to do; the file has not been changed.
 */
export class StoreOpenError extends Error {
  readonly path: string;
  readonly reason: 'foreign' | 'newer' | 'unreadable';

  constructor(
    path: string,
    reason: 'foreign' | 'newer' | 'unreadable',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'StoreOpenError';
    this.path = path;
    this.reason = reason;
  }
}

// -- row schemas ---------------------------------------------------------------

const PROXY_COLUMNS =
  'id, scheme, host, port, username, password, created_at, check_ok, exit_ip, country, latency_ms, checked_at, check_error';
const SESSION_COLUMNS =
  'id, name, proxy_id, identity, summary, timezone, created_at, last_started_at, tabs, location';
const SECRET_COLUMNS =
  'id, kind, title, session_id, fields, created_at, updated_at';

const idColumn = z.number().int();

const proxyRowSchema = z.object({
  id: idColumn,
  scheme: schemeSchema,
  host: z.string(),
  port: z.number().int(),
  username: z.string().nullable(),
  password: z.string().nullable(),
  created_at: z.string(),
  check_ok: z.number().int().nullable(),
  exit_ip: z.string().nullable(),
  country: z.string().nullable(),
  latency_ms: z.number().nullable(),
  checked_at: z.string().nullable(),
  check_error: z.string().nullable(),
});

const proxyStateRowSchema = z.object({
  id: idColumn,
  check_ok: z.number().int().nullable(),
  exit_ip: z.string().nullable(),
});

const sessionRowSchema = z.object({
  id: idColumn,
  name: z.string(),
  proxy_id: idColumn.nullable(),
  identity: z.string(),
  summary: z.string(),
  timezone: z.string().nullable(),
  created_at: z.string(),
  last_started_at: z.string().nullable(),
  tabs: z.string().nullable(),
  location: z.string().nullable(),
});

const sessionLinkRowSchema = z.object({
  id: idColumn,
  name: z.string(),
  proxy_id: idColumn.nullable(),
});

const summarySchema = z.object({
  userAgent: z.string().nullable(),
  platform: z.string().nullable(),
  screen: z.string().nullable(),
  gpu: z.string().nullable(),
});

const secretRowSchema = z.object({
  id: idColumn,
  kind: secretKindSchema,
  title: z.string(),
  session_id: idColumn.nullable(),
  fields: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

const preferenceRowSchema = z.object({ key: z.string(), value: z.string() });
const nameRowSchema = z.object({ name: z.string() });
const idRowSchema = z.object({ id: idColumn });
const countRowSchema = z.object({ count: z.number().int() });
const signaturesRowSchema = z.object({
  visible_signature: z.string(),
  full_signature: z.string(),
});
const exitIpRowSchema = z.object({ exit_ip: z.string() });
const pragmaRowSchema = z.record(z.string(), z.number().int());

const secretFieldsSchema = z.array(secretFieldSchema);

function toProxy(raw: unknown): ProxyRecord {
  const row = proxyRowSchema.parse(raw);
  return {
    id: row.id,
    config: {
      scheme: row.scheme,
      host: row.host,
      port: row.port,
      username: row.username,
      password: row.password,
    },
    createdAt: row.created_at,
    check: {
      ok: row.check_ok === null ? null : row.check_ok !== 0,
      exitIp: row.exit_ip,
      country: row.country,
      latencyMs: row.latency_ms,
      checkedAt: row.checked_at,
      error: row.check_error,
    },
  };
}

function toSession(raw: unknown): SessionRecord {
  const row = sessionRowSchema.parse(raw);
  return {
    id: row.id,
    name: row.name,
    proxyId: row.proxy_id,
    identity: identityFromJson(row.identity),
    summary: summarySchema.parse(JSON.parse(row.summary)),
    timezone: row.timezone,
    createdAt: row.created_at,
    lastStartedAt: row.last_started_at,
    tabs: row.tabs ? layoutFromJson(row.tabs) : null,
    location: row.location ? locationFromJson(row.location) : null,
  };
}

function toSecret(raw: unknown): SecretRecord {
  const row = secretRowSchema.parse(raw);
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    sessionId: row.session_id,
    fields: secretFieldsSchema.parse(JSON.parse(row.fields)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// -- small helpers -------------------------------------------------------------

type Param = string | number | null;

/** "2026-11-01T09:55:00+00:00": UTC, to the second. */
export function timestamp(date: Date): string {
  return `${date.toISOString().slice(0, 19)}+00:00`;
}

/** Could a row have this id? (Ids are the API's: whole numbers up to `MAX_ID`.) */
function isKnownId(id: number): boolean {
  return Number.isSafeInteger(id) && id >= 1 && id <= MAX_ID;
}

function isConstraintError(error: unknown): boolean {
  return (
    error instanceof SQLiteError &&
    (error.code ?? '').startsWith('SQLITE_CONSTRAINT')
  );
}

function isUniqueViolation(error: unknown, column: string): boolean {
  return (
    error instanceof SQLiteError &&
    error.code === 'SQLITE_CONSTRAINT_UNIQUE' &&
    error.message.includes(column)
  );
}

function fieldsJson(fields: readonly SecretField[]): string {
  return JSON.stringify(
    fields.map(({ label, value, hidden }) => ({ label, value, hidden })),
  );
}

// -- opening -------------------------------------------------------------------

function integerPragma(db: Database, name: 'application_id' | 'user_version') {
  const sql =
    name === 'application_id' ? 'PRAGMA application_id' : 'PRAGMA user_version';
  const row = pragmaRowSchema.parse(db.query<unknown, Param[]>(sql).get());
  return row[name] ?? 0;
}

function objectCount(db: Database): number {
  const row = db
    .query<unknown, Param[]>(
      "SELECT COUNT(*) AS count FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'",
    )
    .get();
  return countRowSchema.parse(row).count;
}

/**
 * Is this database new (nothing in it), ours, or someone else's? Only reads:
 * a database that is not ours is left exactly as it is.
 */
function whose(db: Database, path: string): 'new' | 'ours' {
  let applicationId: number;
  let version: number;
  let objects: number;
  try {
    applicationId = integerPragma(db, 'application_id');
    version = integerPragma(db, 'user_version');
    objects = objectCount(db);
  } catch (error) {
    throw new StoreOpenError(
      path,
      'unreadable',
      `${path} is not an SQLite database that can be read (${errorText(error)}). It was left as it is: move it away, or use another data directory.`,
      { cause: error },
    );
  }
  if (applicationId === APPLICATION_ID) {
    if (version > SCHEMA_VERSION) {
      throw new StoreOpenError(
        path,
        'newer',
        `${path} was made by a newer version of Session Manager (database version ${version}, this one works with version ${SCHEMA_VERSION}). It was left as it is: update the app, or use another data directory.`,
      );
    }
    return objects === 0 ? 'new' : 'ours';
  }
  if (applicationId !== 0 || objects > 0) {
    throw new StoreOpenError(
      path,
      'foreign',
      `${path} is not a Session Manager database: ${objects > 0 ? 'it has tables, but ' : ''}its application id is ${applicationId}, not ${APPLICATION_ID}. It was left as it is: move it away, or use another data directory.`,
    );
  }
  return 'new';
}

export interface StoreOptions {
  /** The clock for `created_at`, `checked_at`, ... Default: the system's. */
  now?: () => Date;
}

/** The files SQLite keeps next to a database while it is open or was not closed. */
const BESIDE = ['-wal', '-shm', '-journal'] as const;

/** Only its user can read or write the database and what lies next to it. */
function makePrivate(path: string): void {
  for (const file of [path, ...BESIDE.map((suffix) => `${path}${suffix}`)]) {
    if (existsSync(file)) chmodSync(file, 0o600);
  }
}

/**
 * Opens (and, if it is new, creates) the database at `path`; `:memory:` is a
 * database that lives as long as the store. The file is private to the user
 * (it holds proxy passwords and secrets), also one that was there with other
 * rights. Throws a `StoreOpenError` for a file that is not this app's
 * database, without changing it (not even its rights).
 */
export function openStore(path: string, options: StoreOptions = {}): Store {
  const inMemory = path === ':memory:';
  const existed = !inMemory && existsSync(path);
  if (!inMemory) mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new Database(path, { create: true, strict: true });
  try {
    // A file this call made is empty and ours: private before anything is written.
    if (!inMemory && !existed) chmodSync(path, 0o600);
    // Per connection, and not inside a transaction.
    db.run(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    db.run('PRAGMA foreign_keys = ON');
    // A deleted secret or an old password is overwritten, not left in the free
    // pages of the file (the SQLite of Bun on Linux does not do this by default).
    db.run('PRAGMA secure_delete = ON');
    if (whose(db, path) === 'new') {
      db.transaction(() => {
        db.run(SCHEMA);
        db.run(`PRAGMA application_id = ${APPLICATION_ID}`);
        db.run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      })();
    }
    // It is this app's database: the rights of a file that was there already.
    if (!inMemory) makePrivate(path);
  } catch (error) {
    db.close();
    throw error;
  }
  return new Store(db, options);
}

// -- the store -----------------------------------------------------------------

export class Store {
  readonly #db: Database;
  readonly #now: () => Date;

  /** Use `openStore`. */
  constructor(db: Database, options: StoreOptions = {}) {
    this.#db = db;
    this.#now = options.now ?? (() => new Date());
  }

  close(): void {
    this.#db.close();
  }

  #all(sql: string, ...params: Param[]): unknown[] {
    return this.#db.query<unknown, Param[]>(sql).all(...params);
  }

  #get(sql: string, ...params: Param[]): unknown {
    return this.#db.query<unknown, Param[]>(sql).get(...params);
  }

  #run(sql: string, ...params: Param[]): Changes {
    return this.#db.query<unknown, Param[]>(sql).run(...params);
  }

  #stamp(): string {
    return timestamp(this.#now());
  }

  #count(sql: string): number {
    return countRowSchema.parse(this.#get(sql)).count;
  }

  // -- proxies -----------------------------------------------------------------

  /** Throws `DuplicateProxyError` when the pool has the proxy already. */
  addProxy(config: ProxyConfig): ProxyRecord {
    const [result] = this.addProxies([config]);
    if (!result.added) throw new DuplicateProxyError(result.existingId);
    return result.record;
  }

  /**
   * Adds the proxies in one transaction (a list of thousands is one commit).
   * The results are in the order of `configs`; a proxy that is in the pool
   * already, or earlier in `configs`, is reported with the id it has.
   */
  addProxies(configs: readonly ProxyConfig[]): AddProxyResult[] {
    return this.#db.transaction((): AddProxyResult[] =>
      configs.map((config) => {
        const key = identityKeyOf(config);
        const existing = this.proxyIdForKey(key);
        if (existing !== null) return { added: false, existingId: existing };
        const createdAt = this.#stamp();
        const { lastInsertRowid } = this.#run(
          'INSERT INTO proxies (scheme, host, port, username, password, identity_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          config.scheme,
          config.host,
          config.port,
          config.username,
          config.password,
          key,
          createdAt,
        );
        const record: ProxyRecord = {
          id: Number(lastInsertRowid),
          config,
          createdAt,
          check: {
            ok: null,
            exitIp: null,
            country: null,
            latencyMs: null,
            checkedAt: null,
            error: null,
          },
        };
        return { added: true, record };
      }),
    )();
  }

  proxyIdForKey(identityKey: string): number | null {
    const row = this.#get(
      'SELECT id FROM proxies WHERE identity_key = ?',
      identityKey,
    );
    return row === null ? null : idRowSchema.parse(row).id;
  }

  getProxy(proxyId: number): ProxyRecord | null {
    if (!isKnownId(proxyId)) return null;
    const row = this.#get(
      `SELECT ${PROXY_COLUMNS} FROM proxies WHERE id = ?`,
      proxyId,
    );
    return row === null ? null : toProxy(row);
  }

  /** The proxies with these ids, oldest first (ids that are unknown are skipped). */
  getProxies(proxyIds: Iterable<number>): ProxyRecord[] {
    const ids = [...proxyIds];
    if (ids.length === 0) return [];
    return this.#all(
      `SELECT ${PROXY_COLUMNS} FROM proxies WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id`,
      JSON.stringify(ids),
    ).map(toProxy);
  }

  /** Oldest first. */
  listProxies(): ProxyRecord[] {
    return this.#all(`SELECT ${PROXY_COLUMNS} FROM proxies ORDER BY id`).map(
      toProxy,
    );
  }

  /** Every proxy's health, oldest first. */
  proxyStates(): ProxyState[] {
    return this.#all(
      'SELECT id, check_ok, exit_ip FROM proxies ORDER BY id',
    ).map((raw) => {
      const row = proxyStateRowSchema.parse(raw);
      return {
        id: row.id,
        ok: row.check_ok === null ? null : row.check_ok !== 0,
        exitIp: row.exit_ip,
      };
    });
  }

  /** Newest first. */
  proxiesPage(page: Page): ProxyRecord[] {
    return this.#all(
      `SELECT ${PROXY_COLUMNS} FROM proxies WHERE id >= ? AND id < ? ORDER BY id DESC LIMIT ?`,
      ...pageBounds(page),
    ).map(toProxy);
  }

  countProxies(): number {
    return this.#count('SELECT COUNT(*) AS count FROM proxies');
  }

  recordCheckOk(proxyId: number, result: ExitIp): void {
    this.#run(
      'UPDATE proxies SET check_ok = 1, exit_ip = ?, country = ?, latency_ms = ?, checked_at = ?, check_error = NULL WHERE id = ?',
      result.ip,
      result.country,
      result.latencyMs,
      this.#stamp(),
      proxyId,
    );
  }

  recordCheckFailed(proxyId: number, error: string): void {
    // exit_ip and country stay: they describe the last *successful* check.
    this.#run(
      'UPDATE proxies SET check_ok = 0, latency_ms = NULL, checked_at = ?, check_error = ? WHERE id = ?',
      this.#stamp(),
      error,
      proxyId,
    );
  }

  /** The session using the proxy is unassigned (`ON DELETE SET NULL`). */
  deleteProxy(proxyId: number): void {
    this.#run('DELETE FROM proxies WHERE id = ?', proxyId);
  }

  /** The last known exit IPs of the proxies that sessions have. */
  claimedExitIps(): Set<string> {
    return new Set(
      this.#all(
        'SELECT DISTINCT proxies.exit_ip AS exit_ip FROM proxies JOIN sessions ON sessions.proxy_id = proxies.id WHERE proxies.exit_ip IS NOT NULL',
      ).map((row) => exitIpRowSchema.parse(row).exit_ip),
    );
  }

  /** The sessions other than `exceptSessionId` whose proxy last exited through `ip`. */
  sessionsOnExitIp(ip: string, exceptSessionId: number): SessionLink[] {
    return this.#all(
      'SELECT sessions.id AS id, sessions.name AS name, sessions.proxy_id AS proxy_id FROM sessions JOIN proxies ON proxies.id = sessions.proxy_id WHERE proxies.exit_ip = ? AND sessions.id != ? ORDER BY sessions.id',
      ip,
      exceptSessionId,
    ).map(toLink);
  }

  // -- sessions ----------------------------------------------------------------

  /**
   * A new session without a proxy (it claims one when it starts). Throws
   * `NameTakenError` when another session has the name, ignoring case.
   */
  addSession(name: string, generated: GeneratedIdentity): SessionRecord {
    const createdAt = this.#stamp();
    let id: number;
    try {
      const { lastInsertRowid } = this.#run(
        'INSERT INTO sessions (name, name_key, identity, visible_signature, full_signature, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        name,
        casefold(name),
        identityToJson(generated.identity),
        generated.visibleSignature,
        generated.fullSignature,
        JSON.stringify(generated.summary),
        createdAt,
      );
      id = Number(lastInsertRowid);
    } catch (error) {
      if (isUniqueViolation(error, 'sessions.name_key')) {
        throw new NameTakenError();
      }
      throw error;
    }
    return {
      id,
      name,
      proxyId: null,
      identity: generated.identity,
      summary: generated.summary,
      timezone: null,
      createdAt,
      lastStartedAt: null,
      tabs: null,
      location: null,
    };
  }

  sessionIdForName(name: string): number | null {
    const row = this.#get(
      'SELECT id FROM sessions WHERE name_key = ?',
      casefold(name),
    );
    return row === null ? null : idRowSchema.parse(row).id;
  }

  sessionNames(): string[] {
    return this.#all('SELECT name FROM sessions ORDER BY id').map(
      (row) => nameRowSchema.parse(row).name,
    );
  }

  getSession(sessionId: number): SessionRecord | null {
    if (!isKnownId(sessionId)) return null;
    const row = this.#get(
      `SELECT ${SESSION_COLUMNS} FROM sessions WHERE id = ?`,
      sessionId,
    );
    return row === null ? null : toSession(row);
  }

  /** Oldest first. */
  listSessions(): SessionRecord[] {
    return this.#all(`SELECT ${SESSION_COLUMNS} FROM sessions ORDER BY id`).map(
      toSession,
    );
  }

  /** Oldest first, without their identities: what most questions need. */
  sessionLinks(): SessionLink[] {
    return this.#all('SELECT id, name, proxy_id FROM sessions ORDER BY id').map(
      toLink,
    );
  }

  /** Newest first. */
  sessionsPage(page: Page): SessionRecord[] {
    return this.#all(
      `SELECT ${SESSION_COLUMNS} FROM sessions WHERE id >= ? AND id < ? ORDER BY id DESC LIMIT ?`,
      ...pageBounds(page),
    ).map(toSession);
  }

  countSessions(): number {
    return this.#count('SELECT COUNT(*) AS count FROM sessions');
  }

  /** Every signature (visible and full) of the identities the sessions have. */
  signatures(): Set<string> {
    const signatures = new Set<string>();
    for (const raw of this.#all(
      'SELECT visible_signature, full_signature FROM sessions',
    )) {
      const row = signaturesRowSchema.parse(raw);
      signatures.add(row.visible_signature);
      signatures.add(row.full_signature);
    }
    return signatures;
  }

  /** Throws `NameTakenError` when another session has the name, ignoring case. */
  renameSession(sessionId: number, name: string): void {
    try {
      this.#run(
        'UPDATE sessions SET name = ?, name_key = ? WHERE id = ?',
        name,
        casefold(name),
        sessionId,
      );
    } catch (error) {
      if (isUniqueViolation(error, 'sessions.name_key')) {
        throw new NameTakenError();
      }
      throw error;
    }
  }

  /**
   * Gives the session this proxy instead of its current one, and un-pins the
   * language and the timezone and location (they follow the new exit IP).
   * False if the session or the proxy is gone, or another session has the proxy.
   */
  claimProxy(sessionId: number, proxyId: number): boolean {
    return this.#db.transaction((): boolean => {
      const session = this.getSession(sessionId);
      if (session === null) return false;
      try {
        const { changes } = this.#run(
          'UPDATE sessions SET proxy_id = ?, identity = ?, timezone = NULL, location = NULL WHERE id = ?',
          proxyId,
          identityToJson({ ...session.identity, locale: null }),
          sessionId,
        );
        return changes === 1;
      } catch (error) {
        // An unknown proxy (foreign key) or one that is claimed (unique index).
        if (isConstraintError(error)) return false;
        throw error;
      }
    })();
  }

  /** The place and the language the session starts with, and when. */
  recordStart(sessionId: number, identity: Identity, location: Location): void {
    this.#run(
      'UPDATE sessions SET identity = ?, timezone = ?, location = ?, last_started_at = ? WHERE id = ?',
      identityToJson(identity),
      location.timezone,
      locationToJson(location),
      this.#stamp(),
      sessionId,
    );
  }

  /** Remembers the open tabs; an empty layout forgets them (the next start opens the start page). */
  saveTabs(sessionId: number, layout: TabLayout): void {
    this.#run(
      'UPDATE sessions SET tabs = ? WHERE id = ?',
      layout.urls.length > 0 ? layoutToJson(layout) : null,
      sessionId,
    );
  }

  /** Its secrets go with it (`ON DELETE CASCADE`). */
  deleteSession(sessionId: number): void {
    this.#run('DELETE FROM sessions WHERE id = ?', sessionId);
  }

  // -- preferences -------------------------------------------------------------

  preferences(): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    for (const raw of this.#all('SELECT key, value FROM preferences')) {
      const row = preferenceRowSchema.parse(raw);
      const value: unknown = JSON.parse(row.value);
      values[row.key] = value;
    }
    return values;
  }

  setPreferences(values: Readonly<Record<string, unknown>>): void {
    this.#db.transaction(() => {
      for (const [key, value] of Object.entries(values)) {
        this.#run(
          'INSERT INTO preferences (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
          key,
          JSON.stringify(value),
        );
      }
    })();
  }

  // -- secrets -----------------------------------------------------------------

  addSecret(
    kind: SecretKind,
    title: string,
    sessionId: number | null,
    fields: readonly SecretField[],
  ): SecretRecord {
    const now = this.#stamp();
    const { lastInsertRowid } = this.#run(
      'INSERT INTO secrets (kind, title, session_id, fields, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      kind,
      title,
      sessionId,
      fieldsJson(fields),
      now,
      now,
    );
    return {
      id: Number(lastInsertRowid),
      kind,
      title,
      sessionId,
      fields,
      createdAt: now,
      updatedAt: now,
    };
  }

  getSecret(secretId: number): SecretRecord | null {
    if (!isKnownId(secretId)) return null;
    const row = this.#get(
      `SELECT ${SECRET_COLUMNS} FROM secrets WHERE id = ?`,
      secretId,
    );
    return row === null ? null : toSecret(row);
  }

  /**
   * Newest first. With a session as the scope, `includeGlobal` adds the
   * secrets for every session.
   */
  listSecrets(
    options: {
      kind?: SecretKind | null;
      scope?: SecretScope;
      includeGlobal?: boolean;
    } = {},
  ): SecretRecord[] {
    const kind = options.kind ?? null;
    const scope = options.scope ?? 'all';
    let rows: unknown[];
    if (scope === 'all') {
      rows = this.#all(
        `SELECT ${SECRET_COLUMNS} FROM secrets WHERE (?1 IS NULL OR kind = ?1) ORDER BY id DESC`,
        kind,
      );
    } else if (scope === 'global') {
      rows = this.#all(
        `SELECT ${SECRET_COLUMNS} FROM secrets WHERE (?1 IS NULL OR kind = ?1) AND session_id IS NULL ORDER BY id DESC`,
        kind,
      );
    } else {
      // A session that does not exist has nothing of its own.
      rows = this.#all(
        `SELECT ${SECRET_COLUMNS} FROM secrets WHERE (?1 IS NULL OR kind = ?1) AND (session_id = ?2 OR (?3 AND session_id IS NULL)) ORDER BY id DESC`,
        kind,
        scope,
        options.includeGlobal === true ? 1 : 0,
      );
    }
    return rows.map(toSecret);
  }

  countSecrets(): number {
    return this.#count('SELECT COUNT(*) AS count FROM secrets');
  }

  updateSecret(
    secretId: number,
    title: string,
    sessionId: number | null,
    fields: readonly SecretField[],
  ): void {
    this.#run(
      'UPDATE secrets SET title = ?, session_id = ?, fields = ?, updated_at = ? WHERE id = ?',
      title,
      sessionId,
      fieldsJson(fields),
      this.#stamp(),
      secretId,
    );
  }

  deleteSecret(secretId: number): void {
    this.#run('DELETE FROM secrets WHERE id = ?', secretId);
  }
}

function toLink(raw: unknown): SessionLink {
  const row = sessionLinkRowSchema.parse(raw);
  return { id: row.id, name: row.name, proxyId: row.proxy_id };
}

/**
 * `[low, high, limit]` of a page: the id is the rowid, so this is a range scan
 * from the newest row on, without sorting. A negative limit is no limit.
 */
function pageBounds(page: Page): [number, number, number] {
  return [page.minId ?? 0, page.before ?? MAX_ID + 1, page.limit ?? -1];
}
