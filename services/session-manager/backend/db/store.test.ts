import { Database, SQLiteError } from 'bun:sqlite';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { parseProxy } from '../domains/proxies/parsing.ts';
import { identityKeyOf } from '../domains/proxies/types.ts';
import type { ProxyConfig } from '../domains/proxies/types.ts';
import { EMPTY_LAYOUT } from '../lib/web-url.ts';
import {
  fakeGeneratedIdentity,
  fakeLocation,
} from '../testing/fake-browser.ts';
import {
  APPLICATION_ID,
  DuplicateProxyError,
  MAX_ID,
  NameTakenError,
  SCHEMA_VERSION,
  Store,
  StoreOpenError,
  BUSY_TIMEOUT_MS,
  openStore,
  timestamp,
} from './store.ts';

const directories: string[] = [];
const stores: Store[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function tempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'session-manager-store-'));
  directories.push(directory);
  return directory;
}

function open(path = ':memory:', now?: () => Date): Store {
  const store = openStore(path, now === undefined ? {} : { now });
  stores.push(store);
  return store;
}

function proxy(n: number, extra = ''): ProxyConfig {
  return parseProxy(`192.0.2.${n}:8080${extra}`);
}

function ok(ip: string) {
  return { ip, country: 'US', latencyMs: 10 };
}

/** A read-only look at the database file, for what the store does not show. */
function inspect<T>(path: string, look: (db: Database) => T): T {
  const db = new Database(path, { readonly: true });
  try {
    return look(db);
  } finally {
    db.close();
  }
}

function pragma(db: Database, name: string): number {
  const row = db.query(`PRAGMA ${name}`).get();
  if (typeof row !== 'object' || row === null) throw new Error('no row');
  const value: unknown = Object.values(row)[0];
  if (typeof value !== 'number') throw new Error('not a number');
  return value;
}

/** What a session needs besides its name. */
function identity(n = 1) {
  return fakeGeneratedIdentity('windows', n);
}

describe('openStore', () => {
  it('works in memory', () => {
    const store = open();
    expect(store.countProxies()).toBe(0);
    expect(store.listSessions()).toEqual([]);
  });

  it('creates a database marked as this app’s, with foreign keys on', () => {
    const path = join(tempDirectory(), 'manager.db');
    open(path).close();
    inspect(path, (db) => {
      expect(pragma(db, 'application_id')).toBe(APPLICATION_ID);
      expect(pragma(db, 'user_version')).toBe(SCHEMA_VERSION);
      expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
      const tables = db
        .query(
          "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
        )
        .all();
      expect(tables).toEqual([
        { name: 'preferences' },
        { name: 'proxies' },
        { name: 'secrets' },
        { name: 'sessions' },
        { name: 'sqlite_sequence' },
      ]);
    });
    expect(APPLICATION_ID).toBe(0x534d4752);
    expect(SCHEMA_VERSION).toBe(1);
  });

  it('makes a new database file private to the user, and its folder too', () => {
    const path = join(tempDirectory(), 'data', 'manager.db');
    open(path).close();
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(path, '..')).mode & 0o777).toBe(0o700);
  });

  it('keeps the mode of a database file that exists', () => {
    const path = join(tempDirectory(), 'manager.db');
    open(path).close();
    inspect(path, () => undefined);
    open(path).close();
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('makes a database file that exists private too: it may have been made with the mode of a umask or by hand', () => {
    const path = join(tempDirectory(), 'manager.db');
    writeFileSync(path, '');
    chmodSync(path, 0o644);
    open(path).close();
    expect(statSync(path).mode & 0o777).toBe(0o600);

    // One this app made, and somebody copied or unpacked with other rights.
    chmodSync(path, 0o666);
    open(path).close();
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('makes the files next to a database private too, if there are any', () => {
    const path = join(tempDirectory(), 'manager.db');
    open(path).close();
    // A database in WAL mode, with a connection open, has these two.
    const other = new Database(path);
    try {
      other.run('PRAGMA journal_mode = WAL');
      other.run('CREATE TABLE note (text TEXT)');
      other.run("INSERT INTO note VALUES ('x')");
      const beside = ['-wal', '-shm'].map((suffix) => `${path}${suffix}`);
      for (const file of beside) chmodSync(file, 0o644);
      const store = open(path);
      for (const file of beside) {
        expect(statSync(file).mode & 0o777, file).toBe(0o600);
      }
      store.close();
    } finally {
      other.close();
    }
  });

  it('does not make a file private that is not its database', () => {
    const path = join(tempDirectory(), 'manager.db');
    writeFileSync(path, 'a note, not a database. '.repeat(40));
    chmodSync(path, 0o644);
    expect(() => openStore(path)).toThrow(StoreOpenError);
    expect(statSync(path).mode & 0o777).toBe(0o644);
    expect(existsSync(`${path}-wal`)).toBe(false);
  });

  it('waits for another process that holds the database instead of failing at once', async () => {
    const path = join(tempDirectory(), 'manager.db');
    open(path).addProxy(proxy(1));
    // Another program (a backup, a second manager) holds the lock for a moment.
    const holder = spawn(
      process.execPath,
      [
        '-e',
        `import { Database } from 'bun:sqlite';
         const db = new Database(${JSON.stringify(path)});
         db.run('PRAGMA busy_timeout = 0');
         db.run('BEGIN EXCLUSIVE');
         console.log('locked');
         setTimeout(() => { db.run('COMMIT'); db.close(); process.exit(0); }, 700);`,
      ],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    try {
      await new Promise<void>((resolve, reject) => {
        holder.stdout.once('data', () => resolve());
        holder.once('error', reject);
        holder.once('exit', () => reject(new Error('the holder ended early')));
      });
      // Reads wait as writes do (the call blocks until the lock is let go).
      const store = open(path);
      expect(store.countProxies()).toBe(1);
      expect(store.addProxy(proxy(2)).id).toBe(2);
    } finally {
      holder.kill();
    }
  });

  it('gives up after five seconds of waiting, not for ever', () => {
    expect(BUSY_TIMEOUT_MS).toBe(5000);
  });

  it('does not keep what was deleted: a secret that is gone is gone from the file too', () => {
    const path = join(tempDirectory(), 'manager.db');
    const marker = 'PASSWORD-MARKER-5f3a9c1e7b2d4680';
    const store = open(path);
    store.addSecret('credentials', 'Shop login', null, [
      { label: 'Password', value: marker, hidden: true },
    ]);
    // On disk until the transaction is over; the database is read as a file.
    expect(readFileSync(path).includes(marker)).toBe(true);
    store.deleteSecret(1);
    store.close();
    expect(readFileSync(path).includes(marker)).toBe(false);
  });

  it('does not keep what was replaced: the old password of a secret is gone from the file', () => {
    const path = join(tempDirectory(), 'manager.db');
    const marker = 'OLD-PASSWORD-MARKER-77d1c0a9e3b54f26';
    const store = open(path);
    const secret = store.addSecret('credentials', 'Shop login', null, [
      { label: 'Password', value: marker, hidden: true },
    ]);
    store.updateSecret(secret.id, 'Shop login', null, [
      { label: 'Password', value: 'new', hidden: true },
    ]);
    store.close();
    expect(readFileSync(path).includes(marker)).toBe(false);
  });

  it('opens a database it made, and finds the data in it', () => {
    const path = join(tempDirectory(), 'manager.db');
    const first = open(path);
    first.addProxy(proxy(1, ':user:pass'));
    first.setPreferences({ start_page: 'https://example.org' });
    first.close();

    const second = open(path);
    const [stored] = second.listProxies();
    expect(stored.config).toEqual(proxy(1, ':user:pass'));
    expect(second.preferences()).toEqual({ start_page: 'https://example.org' });
  });

  it('turns an empty file into a database', () => {
    const path = join(tempDirectory(), 'manager.db');
    writeFileSync(path, '');
    const store = open(path);
    store.addProxy(proxy(1));
    expect(store.countProxies()).toBe(1);
  });

  it('turns a database without tables and without an application id into one of its own', () => {
    const path = join(tempDirectory(), 'manager.db');
    new Database(path, { create: true }).close();
    expect(open(path).countProxies()).toBe(0);
    inspect(path, (db) => {
      expect(pragma(db, 'application_id')).toBe(APPLICATION_ID);
    });
  });

  describe('a database that is not this app’s', () => {
    // The tables of an earlier program that kept its data in `manager.db`
    // (application id 0).
    const FOREIGN_SCHEMA = `
      CREATE TABLE proxies (id INTEGER PRIMARY KEY AUTOINCREMENT, scheme TEXT NOT NULL, host TEXT NOT NULL,
        port INTEGER NOT NULL, username TEXT, password TEXT, identity_key TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, check_ok INTEGER, exit_ip TEXT, country TEXT,
        latency_ms INTEGER, checked_at TEXT, check_error TEXT);
      CREATE TABLE sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE,
        proxy_id INTEGER REFERENCES proxies(id) ON DELETE SET NULL, identity TEXT NOT NULL,
        visible_signature TEXT NOT NULL UNIQUE, full_signature TEXT NOT NULL UNIQUE, summary TEXT NOT NULL,
        timezone TEXT, created_at TEXT NOT NULL, last_started_at TEXT, tabs TEXT, location TEXT);
      CREATE TABLE preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO proxies (scheme, host, port, identity_key, created_at)
        VALUES ('http', '192.0.2.1', 8080, '192.0.2.1:8080||', '2026-10-01T10:00:00+00:00');
      PRAGMA user_version = 4;
    `;

    function digest(path: string): string {
      return createHash('sha256').update(readFileSync(path)).digest('hex');
    }

    function refuse(path: string): StoreOpenError {
      const before = { hash: digest(path), mtime: statSync(path).mtimeMs };
      const files = readdirSync(join(path, '..')).sort();
      let refused: unknown;
      try {
        openStore(path).close();
      } catch (error) {
        refused = error;
      }
      expect(refused).toBeInstanceOf(StoreOpenError);
      // Not a byte changed, and no journal left next to it.
      expect(digest(path)).toBe(before.hash);
      expect(statSync(path).mtimeMs).toBe(before.mtime);
      expect(readdirSync(join(path, '..')).sort()).toEqual(files);
      if (!(refused instanceof StoreOpenError)) throw new Error('unreachable');
      return refused;
    }

    it('is refused with the cause, and left exactly as it is (tables without an application id)', () => {
      const path = join(tempDirectory(), 'manager.db');
      const db = new Database(path, { create: true });
      db.run(FOREIGN_SCHEMA);
      db.close();

      const refused = refuse(path);
      expect(refused.reason).toBe('foreign');
      expect(refused.path).toBe(path);
      expect(refused.message).toContain('not a Session Manager database');
      expect(refused.message).toContain(
        'it has tables, but its application id is 0',
      );
      expect(refused.message).toContain('move it away');
      expect(refused.message).toContain(path);
    });

    it('is refused when it has another application id, even without tables', () => {
      const path = join(tempDirectory(), 'other.db');
      const db = new Database(path, { create: true });
      db.run('PRAGMA application_id = 1234');
      db.close();
      const refused = refuse(path);
      expect(refused.reason).toBe('foreign');
      expect(refused.message).toContain('its application id is 1234');
      expect(refused.message).not.toContain('it has tables');
    });

    it('is refused when a newer version of this app made it', () => {
      const path = join(tempDirectory(), 'manager.db');
      open(path).close();
      const db = new Database(path);
      db.run(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
      db.close();
      const refused = refuse(path);
      expect(refused.reason).toBe('newer');
      expect(refused.message).toContain('newer version');
    });

    it('is refused when it is no SQLite database at all', () => {
      const path = join(tempDirectory(), 'manager.db');
      writeFileSync(path, 'this is a note, not a database. '.repeat(50));
      const refused = refuse(path);
      expect(refused.reason).toBe('unreadable');
      expect(refused.message).toContain('not an SQLite database');
    });
  });
});

describe('timestamps', () => {
  it('are UTC, to the second', () => {
    expect(timestamp(new Date('2026-11-01T09:55:00.987Z'))).toBe(
      '2026-11-01T09:55:00+00:00',
    );
    const store = open(':memory:', () => new Date('2026-11-01T09:55:00.987Z'));
    const added = store.addProxy(proxy(1));
    expect(added.createdAt).toBe('2026-11-01T09:55:00+00:00');
    store.recordCheckOk(added.id, ok('203.0.113.1'));
    expect(store.getProxy(added.id)?.check.checkedAt).toBe(
      '2026-11-01T09:55:00+00:00',
    );
  });
});

describe('proxies', () => {
  it('are added unchecked, with the id the database gave them', () => {
    const store = open();
    const added = store.addProxy(proxy(1, ':user:secret'));
    expect(added).toMatchObject({
      id: 1,
      config: {
        scheme: 'http',
        host: '192.0.2.1',
        port: 8080,
        username: 'user',
        password: 'secret',
      },
      check: {
        ok: null,
        exitIp: null,
        country: null,
        latencyMs: null,
        checkedAt: null,
        error: null,
      },
    });
    expect(store.getProxy(1)).toEqual(added);
    expect(store.addProxy(proxy(2)).id).toBe(2);
    expect(store.countProxies()).toBe(2);
  });

  it('are one per identity key: the scheme does not make another proxy', () => {
    const store = open();
    const first = store.addProxy(parseProxy('http://u:p@192.0.2.1:8080'));
    expect(store.proxyIdForKey(identityKeyOf(first.config))).toBe(first.id);
    expect(store.proxyIdForKey('192.0.2.9:80||')).toBeNull();
    expect(() =>
      store.addProxy(parseProxy('socks5://u:p@192.0.2.1:8080')),
    ).toThrow(DuplicateProxyError);
    expect(() => store.addProxy(parseProxy('192.0.2.1:8080:u:p'))).toThrow(
      expect.objectContaining({ existingId: first.id }),
    );
    // Another password is another proxy.
    expect(store.addProxy(parseProxy('http://u:other@192.0.2.1:8080')).id).toBe(
      2,
    );
    expect(store.countProxies()).toBe(2);
  });

  it('are added in one transaction, with the id of an earlier duplicate for a repeat', () => {
    const store = open();
    const existing = store.addProxy(proxy(1));
    const results = store.addProxies([proxy(2), proxy(1), proxy(3), proxy(2)]);
    expect(results.map((result) => result.added)).toEqual([
      true,
      false,
      true,
      false,
    ]);
    expect(results[1]).toEqual({ added: false, existingId: existing.id });
    expect(results[3]).toEqual({ added: false, existingId: 2 });
    expect(store.listProxies().map((p) => p.config.host)).toEqual([
      '192.0.2.1',
      '192.0.2.2',
      '192.0.2.3',
    ]);
  });

  it('are all or none when a batch fails half way', () => {
    const store = open();
    const broken: ProxyConfig = {
      scheme: 'http',
      host: '192.0.2.9',
      get port(): number {
        throw new Error('unreadable');
      },
      username: null,
      password: null,
    };
    expect(() => store.addProxies([proxy(1), broken])).toThrow('unreadable');
    expect(store.countProxies()).toBe(0);
  });

  it('are found by id, and an id the database cannot hold is simply unknown', () => {
    const store = open();
    store.addProxy(proxy(1));
    expect(store.getProxy(2)).toBeNull();
    for (const id of [0, -1, 1.5, 10 ** 20, MAX_ID + 2, Number.NaN]) {
      expect(store.getProxy(id)).toBeNull();
    }
  });

  it('are listed oldest first, by ids, and skip the ids that are unknown', () => {
    const store = open();
    for (let n = 1; n <= 4; n++) store.addProxy(proxy(n));
    expect(store.getProxies([3, 1, 99]).map((p) => p.id)).toEqual([1, 3]);
    expect(store.getProxies([]).map((p) => p.id)).toEqual([]);
    expect(store.getProxies(new Set([2, 4])).map((p) => p.id)).toEqual([2, 4]);
    expect(store.listProxies().map((p) => p.id)).toEqual([1, 2, 3, 4]);
    expect(store.proxyStates()).toEqual([
      { id: 1, ok: null, exitIp: null },
      { id: 2, ok: null, exitIp: null },
      { id: 3, ok: null, exitIp: null },
      { id: 4, ok: null, exitIp: null },
    ]);
  });

  it('keep the exit IP of the last successful check when a later check fails', () => {
    const store = open(':memory:', () => new Date('2026-11-01T10:00:00Z'));
    const { id } = store.addProxy(proxy(1));
    store.recordCheckOk(id, {
      ip: '198.51.100.7',
      country: 'CH',
      latencyMs: 42,
    });
    expect(store.getProxy(id)?.check).toEqual({
      ok: true,
      exitIp: '198.51.100.7',
      country: 'CH',
      latencyMs: 42,
      checkedAt: '2026-11-01T10:00:00+00:00',
      error: null,
    });
    store.recordCheckFailed(id, 'cannot connect to the proxy');
    expect(store.getProxy(id)?.check).toEqual({
      ok: false,
      exitIp: '198.51.100.7',
      country: 'CH',
      latencyMs: null,
      checkedAt: '2026-11-01T10:00:00+00:00',
      error: 'cannot connect to the proxy',
    });
    store.recordCheckOk(id, ok('198.51.100.8'));
    expect(store.getProxy(id)?.check).toMatchObject({
      ok: true,
      exitIp: '198.51.100.8',
      error: null,
    });
    expect(store.proxyStates()).toEqual([
      { id, ok: true, exitIp: '198.51.100.8' },
    ]);
  });

  it('are listed in pages, newest first', () => {
    const store = open();
    for (let n = 1; n <= 7; n++) store.addProxy(proxy(n));
    const ids = (page: Parameters<Store['proxiesPage']>[0]) =>
      store.proxiesPage(page).map((p) => p.id);
    expect(ids({})).toEqual([7, 6, 5, 4, 3, 2, 1]);
    expect(ids({ limit: 3 })).toEqual([7, 6, 5]);
    expect(ids({ limit: 3, before: 5 })).toEqual([4, 3, 2]);
    expect(ids({ limit: 3, before: 2 })).toEqual([1]);
    expect(ids({ limit: 3, before: 1 })).toEqual([]);
    expect(ids({ before: 100 })).toEqual([7, 6, 5, 4, 3, 2, 1]);
    // The rows loaded so far and the newer ones.
    expect(ids({ minId: 5 })).toEqual([7, 6, 5]);
    expect(ids({ minId: 8 })).toEqual([]);
    expect(ids({ minId: 3, before: 7, limit: 2 })).toEqual([6, 5]);
    expect(ids({ before: MAX_ID, minId: 1, limit: 500 })).toHaveLength(7);
  });

  it('are deleted, and the session that had one keeps its place without it', () => {
    const store = open();
    const { id: proxyId } = store.addProxy(proxy(1));
    const session = store.addSession('a', identity());
    expect(store.claimProxy(session.id, proxyId)).toBe(true);
    store.deleteProxy(proxyId);
    expect(store.getProxy(proxyId)).toBeNull();
    expect(store.getSession(session.id)?.proxyId).toBeNull();
    store.deleteProxy(proxyId); // nothing to delete
  });

  it('say which exit IPs sessions have, and which sessions are on one', () => {
    const store = open();
    const a = store.addProxy(proxy(1)).id;
    const b = store.addProxy(proxy(2)).id;
    const c = store.addProxy(proxy(3)).id;
    store.recordCheckOk(a, ok('203.0.113.1'));
    store.recordCheckOk(b, ok('203.0.113.1'));
    store.recordCheckOk(c, ok('203.0.113.3'));
    const one = store.addSession('one', identity(1));
    const two = store.addSession('two', identity(2));
    expect(store.claimedExitIps()).toEqual(new Set());
    store.claimProxy(one.id, a);
    store.claimProxy(two.id, b);
    expect(store.claimedExitIps()).toEqual(new Set(['203.0.113.1']));
    expect(store.sessionsOnExitIp('203.0.113.1', one.id)).toEqual([
      { id: two.id, name: 'two', proxyId: b },
    ]);
    expect(
      store.sessionsOnExitIp('203.0.113.1', 999).map((s) => s.name),
    ).toEqual(['one', 'two']);
    expect(store.sessionsOnExitIp('203.0.113.3', one.id)).toEqual([]);
  });
});

describe('sessions', () => {
  it('are added without a proxy, a place or tabs', () => {
    const store = open(':memory:', () => new Date('2026-11-01T10:00:00Z'));
    const generated = identity(1);
    const session = store.addSession('Shop', generated);
    expect(session).toEqual({
      id: 1,
      name: 'Shop',
      proxyId: null,
      identity: generated.identity,
      summary: generated.summary,
      timezone: null,
      createdAt: '2026-11-01T10:00:00+00:00',
      lastStartedAt: null,
      tabs: null,
      location: null,
    });
    expect(store.getSession(1)).toEqual(session);
    expect(store.countSessions()).toBe(1);
  });

  it('have names that are unique ignoring case', () => {
    const store = open();
    const first = store.addSession('Shop Ä', identity(1));
    expect(() => store.addSession('shop ä', identity(2))).toThrow(
      NameTakenError,
    );
    expect(store.countSessions()).toBe(1);
    expect(store.sessionIdForName('SHOP Ä')).toBe(first.id);
    expect(store.sessionIdForName('other')).toBeNull();
    expect(store.sessionNames()).toEqual(['Shop Ä']);
  });

  it('have signatures that are unique, and that fail differently from a taken name', () => {
    const store = open();
    store.addSession('a', identity(1));
    try {
      store.addSession('b', identity(1));
      expect.unreachable('a taken signature');
    } catch (error) {
      expect(error).toBeInstanceOf(SQLiteError);
      expect(error).not.toBeInstanceOf(NameTakenError);
    }
    expect(store.signatures()).toEqual(new Set(['visible-1', 'full-1']));
    store.addSession('c', identity(2));
    expect(store.signatures()).toEqual(
      new Set(['visible-1', 'full-1', 'visible-2', 'full-2']),
    );
  });

  it('are found by id, listed oldest first and paged newest first', () => {
    const store = open();
    for (let n = 1; n <= 5; n++) store.addSession(`s${n}`, identity(n));
    expect(store.getSession(6)).toBeNull();
    expect(store.getSession(10 ** 20)).toBeNull();
    expect(store.listSessions().map((s) => s.name)).toEqual([
      's1',
      's2',
      's3',
      's4',
      's5',
    ]);
    expect(store.sessionLinks()).toEqual([
      { id: 1, name: 's1', proxyId: null },
      { id: 2, name: 's2', proxyId: null },
      { id: 3, name: 's3', proxyId: null },
      { id: 4, name: 's4', proxyId: null },
      { id: 5, name: 's5', proxyId: null },
    ]);
    const names = (page: Parameters<Store['sessionsPage']>[0]) =>
      store.sessionsPage(page).map((s) => s.name);
    expect(names({})).toEqual(['s5', 's4', 's3', 's2', 's1']);
    expect(names({ limit: 2 })).toEqual(['s5', 's4']);
    expect(names({ limit: 2, before: 4 })).toEqual(['s3', 's2']);
    expect(names({ minId: 4 })).toEqual(['s5', 's4']);
  });

  it('are renamed, to a name in another case too, but not to a name another has', () => {
    const store = open();
    const a = store.addSession('a', identity(1));
    store.addSession('b', identity(2));
    store.renameSession(a.id, 'A');
    expect(store.getSession(a.id)?.name).toBe('A');
    expect(() => store.renameSession(a.id, 'B')).toThrow(NameTakenError);
    expect(store.getSession(a.id)?.name).toBe('A');
  });

  it('can have a proxy that no other session has', () => {
    const store = open();
    const one = store.addProxy(proxy(1)).id;
    const two = store.addProxy(proxy(2)).id;
    const a = store.addSession('a', identity(1));
    const b = store.addSession('b', identity(2));
    expect(store.claimProxy(a.id, one)).toBe(true);
    expect(store.claimProxy(b.id, one)).toBe(false); // the unique index
    expect(store.getSession(b.id)?.proxyId).toBeNull();
    expect(store.claimProxy(b.id, 999)).toBe(false); // no such proxy
    expect(store.claimProxy(999, two)).toBe(false); // no such session
    expect(store.claimProxy(b.id, two)).toBe(true);
    expect(store.getSession(b.id)?.proxyId).toBe(two);
    // A session can move to another proxy, and its old one is free again.
    expect(store.claimProxy(a.id, two)).toBe(false);
    store.deleteProxy(two);
    expect(store.claimProxy(a.id, one)).toBe(true);
    expect(store.claimProxy(b.id, one)).toBe(false);
    expect(store.sessionLinks().map((s) => s.proxyId)).toEqual([one, null]);
  });

  it('forget the place and the language when they get another proxy', () => {
    const store = open();
    store.addProxy(proxy(1));
    store.addProxy(proxy(2));
    const generated = identity(1);
    const withLocale = { ...generated.identity, locale: 'de-CH' };
    const session = store.addSession('a', {
      ...generated,
      identity: withLocale,
    });
    expect(store.claimProxy(session.id, 1)).toBe(true);
    const place = fakeLocation('203.0.113.1', {
      country: 'CH',
      timezone: 'Europe/Zurich',
      latitude: 47.37,
      longitude: 8.54,
    });
    store.recordStart(session.id, withLocale, place);
    store.saveTabs(session.id, { urls: ['https://a.example'], active: 0 });
    const started = store.getSession(session.id);
    expect(started?.location).toEqual(place);
    expect(started?.timezone).toBe('Europe/Zurich');
    expect(started?.identity.locale).toBe('de-CH');

    // Another proxy: another IP, so another place and language.
    expect(store.claimProxy(session.id, 2)).toBe(true);
    const moved = store.getSession(session.id);
    expect(moved?.location).toBeNull();
    expect(moved?.timezone).toBeNull();
    expect(moved?.identity.locale).toBeNull();
    // What is not about the exit IP stays.
    expect(moved?.tabs).toEqual({ urls: ['https://a.example'], active: 0 });
    expect(moved?.identity.fingerprint).toEqual(withLocale.fingerprint);
    expect(moved?.lastStartedAt).toBe(started?.lastStartedAt);
  });

  it('keep the place and the time of their last start', () => {
    const store = open(':memory:', () => new Date('2026-11-01T11:30:00Z'));
    const session = store.addSession('a', identity());
    const place = fakeLocation('203.0.113.5', {
      country: 'CH',
      timezone: 'Europe/Zurich',
      latitude: 47.37,
      longitude: 8.54,
    });
    store.recordStart(
      session.id,
      { ...session.identity, locale: 'fr-CH' },
      place,
    );
    const stored = store.getSession(session.id);
    expect(stored?.location).toEqual(place);
    expect(stored?.timezone).toBe('Europe/Zurich');
    expect(stored?.identity.locale).toBe('fr-CH');
    expect(stored?.lastStartedAt).toBe('2026-11-01T11:30:00+00:00');
  });

  it('remember their tabs, and forget them for an empty layout', () => {
    const store = open();
    const session = store.addSession('a', identity());
    const layout = {
      urls: ['https://a.example', 'https://b.example'],
      active: 1,
    };
    store.saveTabs(session.id, layout);
    expect(store.getSession(session.id)?.tabs).toEqual(layout);
    store.saveTabs(session.id, EMPTY_LAYOUT); // the start page next time
    expect(store.getSession(session.id)?.tabs).toBeNull();
    store.saveTabs(999, layout); // a session that is gone: nothing happens
  });

  it('take their secrets with them when they are deleted, and only those', () => {
    const store = open();
    const a = store.addSession('a', identity(1));
    const everyone = store.addSecret('note', 'for all', null, [
      { label: 'Note', value: 'x', hidden: false },
    ]);
    store.addSecret('note', 'of a', a.id, [
      { label: 'Note', value: 'y', hidden: false },
    ]);
    store.deleteSession(a.id);
    expect(store.getSession(a.id)).toBeNull();
    expect(store.listSecrets().map((s) => s.id)).toEqual([everyone.id]);
  });
});

describe('preferences', () => {
  it('start empty, and keep what is set, as JSON', () => {
    const store = open();
    expect(store.preferences()).toEqual({});
    store.setPreferences({
      start_page: 'https://example.org',
      mcp_enabled: true,
    });
    expect(store.preferences()).toEqual({
      start_page: 'https://example.org',
      mcp_enabled: true,
    });
    store.setPreferences({ mcp_enabled: false, list: [1, 'two', null] });
    expect(store.preferences()).toEqual({
      start_page: 'https://example.org',
      mcp_enabled: false,
      list: [1, 'two', null],
    });
    store.setPreferences({}); // nothing to set
    expect(Object.keys(store.preferences()).sort()).toEqual([
      'list',
      'mcp_enabled',
      'start_page',
    ]);
  });
});

describe('secrets', () => {
  const field = (label: string, value: string, hidden = false) => ({
    label,
    value,
    hidden,
  });

  it('are added with the time, and read back with their fields', () => {
    const store = open(':memory:', () => new Date('2026-11-01T12:00:00Z'));
    const added = store.addSecret('credentials', 'Shop login', null, [
      field('Website', 'https://shop.example'),
      field('Password', 'hunter2 ', true),
    ]);
    expect(added).toEqual({
      id: 1,
      kind: 'credentials',
      title: 'Shop login',
      sessionId: null,
      fields: [
        { label: 'Website', value: 'https://shop.example', hidden: false },
        { label: 'Password', value: 'hunter2 ', hidden: true },
      ],
      createdAt: '2026-11-01T12:00:00+00:00',
      updatedAt: '2026-11-01T12:00:00+00:00',
    });
    expect(store.getSecret(1)).toEqual(added);
    expect(store.countSecrets()).toBe(1);
    expect(store.getSecret(2)).toBeNull();
    expect(store.getSecret(10 ** 20)).toBeNull();
  });

  it('are listed newest first, by kind and by scope', () => {
    const store = open();
    const a = store.addSession('a', identity(1)).id;
    const b = store.addSession('b', identity(2)).id;
    const login = store.addSecret('credentials', 'login', null, [
      field('U', 'u'),
    ]);
    const cardA = store.addSecret('card', 'card of a', a, [
      field('Cardholder', 'A'),
    ]);
    const noteB = store.addSecret('note', 'note of b', b, [field('Note', 'n')]);
    const ids = (options: Parameters<Store['listSecrets']>[0]) =>
      store.listSecrets(options).map((secret) => secret.id);

    expect(ids({})).toEqual([noteB.id, cardA.id, login.id]);
    expect(ids({ kind: 'card' })).toEqual([cardA.id]);
    expect(ids({ kind: null })).toEqual([noteB.id, cardA.id, login.id]);
    expect(ids({ scope: 'global' })).toEqual([login.id]);
    expect(ids({ scope: a })).toEqual([cardA.id]);
    expect(ids({ scope: a, includeGlobal: true })).toEqual([
      cardA.id,
      login.id,
    ]);
    expect(ids({ scope: a, includeGlobal: true, kind: 'credentials' })).toEqual(
      [login.id],
    );
    expect(ids({ scope: 'global', kind: 'card' })).toEqual([]);
    // No such session: nothing of its own (the secrets for everyone still show).
    expect(ids({ scope: 999 })).toEqual([]);
    expect(ids({ scope: 999, includeGlobal: true })).toEqual([login.id]);
    expect(ids({ scope: 10 ** 20 })).toEqual([]);
  });

  it('are updated, in their title, session and fields, and the time', () => {
    let now = new Date('2026-11-01T12:00:00Z');
    const store = open(':memory:', () => now);
    const session = store.addSession('a', identity()).id;
    const secret = store.addSecret('note', 'old', null, [field('Note', 'one')]);
    now = new Date('2026-11-01T13:00:00Z');
    store.updateSecret(secret.id, 'new', session, [field('Note', 'two')]);
    expect(store.getSecret(secret.id)).toEqual({
      id: secret.id,
      kind: 'note',
      title: 'new',
      sessionId: session,
      fields: [{ label: 'Note', value: 'two', hidden: false }],
      createdAt: '2026-11-01T12:00:00+00:00',
      updatedAt: '2026-11-01T13:00:00+00:00',
    });
    store.updateSecret(secret.id, 'new', null, [field('Note', 'two')]);
    expect(store.getSecret(secret.id)?.sessionId).toBeNull();
  });

  it('are deleted', () => {
    const store = open();
    const secret = store.addSecret('note', 'x', null, [field('Note', 'x')]);
    store.deleteSecret(secret.id);
    expect(store.getSecret(secret.id)).toBeNull();
    expect(store.countSecrets()).toBe(0);
    store.deleteSecret(secret.id); // nothing to delete
  });

  it('cannot belong to a session that does not exist', () => {
    const store = open();
    expect(() =>
      store.addSecret('note', 'x', 999, [field('Note', 'x')]),
    ).toThrow(SQLiteError);
    expect(store.countSecrets()).toBe(0);
  });
});

describe('what the database enforces', () => {
  it('is checked on the file: no foreign key points nowhere after deletions', () => {
    const path = join(tempDirectory(), 'manager.db');
    const store = open(path);
    const proxyId = store.addProxy(proxy(1)).id;
    const session = store.addSession('a', identity());
    store.claimProxy(session.id, proxyId);
    store.addSecret('note', 'x', session.id, [
      { label: 'Note', value: 'x', hidden: false },
    ]);
    store.deleteProxy(proxyId);
    store.deleteSession(session.id);
    inspect(path, (db) => {
      expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(db.query('SELECT COUNT(*) AS n FROM secrets').get()).toEqual({
        n: 0,
      });
    });
  });

  it('never reuses the id of a deleted row', () => {
    const store = open();
    const first = store.addProxy(proxy(1));
    store.deleteProxy(first.id);
    expect(store.addProxy(proxy(2)).id).toBe(first.id + 1);
  });

  it('refuses a second proxy for one session at the SQL level too', () => {
    const path = join(tempDirectory(), 'manager.db');
    const store = open(path);
    store.addProxy(proxy(1));
    store.addSession('a', identity(1));
    store.addSession('b', identity(2));
    const raw = new Database(path);
    try {
      raw.run('UPDATE sessions SET proxy_id = 1 WHERE id = 1');
      expect(() =>
        raw.run('UPDATE sessions SET proxy_id = 1 WHERE id = 2'),
      ).toThrow(/UNIQUE/);
    } finally {
      raw.close();
    }
  });

  it('refuses a stored identity of a shape it does not know', () => {
    const path = join(tempDirectory(), 'manager.db');
    const store = open(path);
    store.addSession('a', identity());
    const raw = new Database(path);
    try {
      raw.run(`UPDATE sessions SET identity = '{"schema": 99}'`);
    } finally {
      raw.close();
    }
    expect(() => store.listSessions()).toThrow();
  });
});
