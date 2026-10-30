// @vitest-environment node

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isDatabaseUnavailable,
  knowledgeDatabaseUnavailable,
} from '../../db/unavailable';
import {
  bm25Available,
  closeKnowledgePools,
  defaultKnowledgeUrl,
  getKnowledgePool,
  getKnowledgePoolForOrg,
  invalidateOrgUrl,
  isConnectionFailure,
  type KnowledgeOutage,
  markBm25Unavailable,
  openKnowledgeSession,
  resolveOrgUrl,
  setCorpusBootstrapHook,
  setKnowledgeOutageReporter,
  setPoolFactory,
} from './pool';

/**
 * Tenant isolation is the highest-priority invariant in this subsystem, and it
 * is enforced in exactly one place: which connection an organization's corpus is
 * addressed through. So these tests assert it from BOTH directions —
 *
 *   - an organization with its own database NEVER resolves to the shared one;
 *   - an organization WITHOUT one never resolves to another organization's.
 *
 * They stub the pool factory rather than opening a database, because the thing
 * being tested is the routing decision, not PostgreSQL. Every call is recorded,
 * so "never reached the default pool" is a statement about observed calls rather
 * than about code reading.
 *
 * The configuration is real: temporary config files on disk, read by the same
 * code the deployment runs. Mocking the reader would test the mock.
 */

const DEFAULT_URL = 'postgresql://tale:pw@knowledge-db:5432/tale_knowledge';

let configRoot: string;
let opened: string[];
let ended: string[];
let previousConfigDir: string | undefined;
let previousDatabaseUrl: string | undefined;

/** A pool double that records nothing but its connection string. Like a
 * postgres.js pool, it fails every statement after `end()`. */
function stubPool(url: string): Sql {
  opened.push(url);
  let ending = false;
  const answer = () =>
    ending
      ? Promise.reject(
          Object.assign(new Error(`write CONNECTION_ENDED ${url}`), {
            code: 'CONNECTION_ENDED',
          }),
        )
      : Promise.resolve([]);
  const sql = ((..._args: unknown[]) => answer()) as unknown as Sql & {
    url: string;
  };
  sql.url = url;
  sql.end = () => {
    ending = true;
    ended.push(url);
    return Promise.resolve();
  };
  const unsafe = () => answer() as never;
  sql.unsafe = unsafe;
  // The bootstrap holds its advisory lock on one reserved connection; the
  // double answers it with the same recording surface.
  sql.reserve = (() =>
    Promise.resolve({
      unsafe,
      release: () => undefined,
    })) as unknown as Sql['reserve'];
  return sql;
}

/** Write `<root>/<org>/knowledge/connection.json`. */
function writeConnection(orgSlug: string, connection: unknown): void {
  const dir = path.join(configRoot, orgSlug, 'knowledge');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, 'connection.json'),
    JSON.stringify(connection, null, 2),
  );
}

function urlOf(sql: Sql): string {
  return (sql as unknown as { url: string }).url;
}

beforeEach(() => {
  configRoot = mkdtempSync(path.join(tmpdir(), 'knowledge-pool-'));
  opened = [];
  ended = [];
  previousConfigDir = process.env.TALE_CONFIG_DIR;
  previousDatabaseUrl = process.env.KNOWLEDGE_DATABASE_URL;
  process.env.TALE_CONFIG_DIR = configRoot;
  process.env.KNOWLEDGE_DATABASE_URL = DEFAULT_URL;
  setPoolFactory(stubPool);
});

afterEach(async () => {
  await closeKnowledgePools();
  setPoolFactory(null);
  setKnowledgeOutageReporter(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
  rmSync(configRoot, { recursive: true, force: true });
  if (previousConfigDir === undefined) delete process.env.TALE_CONFIG_DIR;
  else process.env.TALE_CONFIG_DIR = previousConfigDir;
  if (previousDatabaseUrl === undefined)
    delete process.env.KNOWLEDGE_DATABASE_URL;
  else process.env.KNOWLEDGE_DATABASE_URL = previousDatabaseUrl;
});

describe('the tenant chokepoint', () => {
  it('routes an organization with its own database away from the shared one [KNOW-R2]', async () => {
    writeConnection('acme', {
      host: 'acme-db.example.com',
      port: 5432,
      database: 'acme_knowledge',
      user: 'acme',
      sslmode: 'require',
    });

    const sql = await getKnowledgePoolForOrg('acme');

    expect(urlOf(sql)).toContain('acme-db.example.com');
    expect(urlOf(sql)).toContain('acme_knowledge');
    // The direction that matters: the shared database was never opened.
    expect(opened).not.toContain(DEFAULT_URL);
    expect(urlOf(sql)).not.toBe(DEFAULT_URL);
  });

  it('never lets one organization reach another organization corpus [KNOW-R2]', async () => {
    writeConnection('acme', {
      host: 'acme-db.example.com',
      port: 5432,
      database: 'acme_knowledge',
      user: 'acme',
      sslmode: 'require',
    });
    writeConnection('globex', {
      host: 'globex-db.example.com',
      port: 5432,
      database: 'globex_knowledge',
      user: 'globex',
      sslmode: 'require',
    });

    const acme = await getKnowledgePoolForOrg('acme');
    const globex = await getKnowledgePoolForOrg('globex');

    expect(acme).not.toBe(globex);
    expect(urlOf(acme)).toContain('acme-db.example.com');
    expect(urlOf(globex)).toContain('globex-db.example.com');
    expect(urlOf(acme)).not.toContain('globex');
    expect(urlOf(globex)).not.toContain('acme');
  });

  it('gives an organization without its own database the deployment default [KNOW-R2]', async () => {
    const sql = await getKnowledgePoolForOrg('startup');
    expect(urlOf(sql)).toBe(DEFAULT_URL);
  });

  it('does not bootstrap a schema onto the shared database', async () => {
    // Its schema is applied at container start, and the application role may not
    // be allowed to create extensions — attempting it on every request would
    // fail loudly for no benefit.
    const sql = await getKnowledgePoolForOrg('startup');
    expect(urlOf(sql)).toBe(DEFAULT_URL);
    // Reaching the default pool did not need the corpus migrations to exist,
    // which is what a bootstrap attempt would have required.
    expect(opened).toEqual([DEFAULT_URL]);
  });

  it('shares one pool between organizations on the same database', async () => {
    // A pool per organization would exhaust the target's connection limit.
    // Sharing a pool is not sharing data: every statement is org-scoped.
    const first = await getKnowledgePoolForOrg('one');
    const second = await getKnowledgePoolForOrg('two');
    expect(first).toBe(second);
    expect(opened).toEqual([DEFAULT_URL]);
  });

  it('keeps the deployment default reachable for maintenance', () => {
    const sql = getKnowledgePool();
    expect(urlOf(sql)).toBe(DEFAULT_URL);
  });
});

describe('shutdown', () => {
  it('closes every open pool and forgets it, so a later call opens afresh', async () => {
    // main.ts drains these after pg-boss stops: an own database and the
    // shared one are both ended, and neither is handed out again.
    writeConnection('acme', {
      host: 'acme-db.example.com',
      port: 5432,
      database: 'acme_knowledge',
      user: 'acme',
      sslmode: 'require',
    });
    const shared = getKnowledgePool();
    const own = await getKnowledgePoolForOrg('acme');
    expect(ended).toEqual([]);

    await closeKnowledgePools();

    expect(ended).toHaveLength(2);
    expect(ended).toEqual(expect.arrayContaining([urlOf(shared), urlOf(own)]));
    expect(getKnowledgePool()).not.toBe(shared);
    expect(opened).toHaveLength(3);
  });
});

/** Write an own database for `orgSlug` and get its pool. */
async function ownPool(orgSlug: string): Promise<Sql> {
  writeConnection(orgSlug, {
    host: `${orgSlug}-db.example.com`,
    port: 5432,
    database: 'k',
    user: 'u',
    sslmode: 'require',
  });
  return getKnowledgePoolForOrg(orgSlug);
}

describe('eviction [KNOW-R20]', () => {
  // 64 pools may stay open (`MAX_POOLS`): org-0 … org-63 fill them, and
  // org-64 retires the least recently used, org-0's.
  async function fillAndEvict(): Promise<Sql> {
    const first = await ownPool('org-0');
    for (let i = 1; i <= 64; i++) await ownPool(`org-${i}`);
    return first;
  }

  it('retires a pool without ending it, so a caller still holding it finishes', async () => {
    const first = await fillAndEvict();

    // `end()` would fail the holder's next statement (`CONNECTION_ENDED`),
    // the platform's own doing read as an outage.
    expect(ended).toEqual([]);
    await expect(first`SELECT 1`).resolves.toEqual([]);
    // A later caller gets a pool of its own, opened afresh.
    const again = await getKnowledgePoolForOrg('org-0');
    expect(again).not.toBe(first);
    expect(opened.filter((url) => url === urlOf(first))).toHaveLength(2);
  });

  it('ends a retired pool at shutdown', async () => {
    const first = await fillAndEvict();
    await closeKnowledgePools();
    expect(ended.filter((url) => url === urlOf(first))).toHaveLength(1);
    expect(ended).toHaveLength(65);
  });
});

/** A port nothing listens on: a connection to it is refused at once. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  return port;
}

/** What `pending` was rejected with. */
function failure(pending: PromiseLike<unknown>): Promise<unknown> {
  return Promise.resolve(pending).then(
    () => {
      throw new Error('expected the statement to fail');
    },
    (error: unknown) => error,
  );
}

describe('which database a failure came from', () => {
  // The real driver against a port nothing listens on: what it rejects a
  // statement with is what a knowledge database that stopped answering gives.
  let port: number;
  beforeEach(async () => {
    port = await closedPort();
    setPoolFactory(null);
  });

  it('marks every statement of the deployment pool as its own, never the platform database [KNOW-R2]', async () => {
    process.env.KNOWLEDGE_DATABASE_URL = `postgres://tale:pw@127.0.0.1:${port}/tale_knowledge`;
    const sql = getKnowledgePool();
    const statements: (() => PromiseLike<unknown>)[] = [
      () => sql`SELECT 1`,
      () => sql.unsafe('SELECT 1'),
      () => sql.begin((tx) => tx`SELECT 1`),
      () => sql.reserve(),
    ];
    for (const statement of statements) {
      const error = await failure(statement());
      expect(error).toMatchObject({ code: 'ECONNREFUSED' });
      expect(knowledgeDatabaseUnavailable(error)).toBe('deployment');
      expect(isDatabaseUnavailable(error)).toBe(false);
    }
  });

  it('marks what an organization database fails with as that organization database', async () => {
    writeConnection('acme', {
      host: '127.0.0.1',
      port,
      database: 'acme_knowledge',
      user: 'acme',
      sslmode: 'disable',
    });
    // The first touch bootstraps the schema on a reserved connection.
    const error = await failure(getKnowledgePoolForOrg('acme'));
    expect(error).toMatchObject({ code: 'ECONNREFUSED' });
    expect(knowledgeDatabaseUnavailable(error)).toBe('organization');
    expect(isDatabaseUnavailable(error)).toBe(false);
  });

  it('marks a maintenance session by the database it reaches', async () => {
    const session = openKnowledgeSession(
      `postgres://acme:pw@127.0.0.1:${port}/acme_knowledge`,
    );
    try {
      const error = await failure(session`SELECT 1`);
      expect(knowledgeDatabaseUnavailable(error)).toBe('organization');
    } finally {
      await session.end({ timeout: 0 });
    }
  });
});

/** A query double: a promise that settles through its own `resolve` and
 * `reject`, as a postgres.js `Query` does. */
function fakeQuery(): Promise<unknown> & {
  resolve: (rows: unknown) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (rows: unknown) => void;
  let reject!: (error: unknown) => void;
  const query = new Promise<unknown>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return Object.assign(query, { resolve, reject });
}

/** What the next statement of a {@link settlingPool} settles with: rows, or
 * the error it is rejected with. */
let answer: () => unknown;

/** A pool double whose statements settle as the driver's do: a microtask
 * after they are made, through the query's `resolve` or `reject`. */
function settlingPool(url: string): Sql {
  opened.push(url);
  const statement = () => {
    const query = fakeQuery();
    const outcome = answer();
    queueMicrotask(() => {
      if (outcome instanceof Error) query.reject(outcome);
      else query.resolve(outcome);
    });
    return query;
  };
  const client = () => Object.assign(() => statement(), { unsafe: statement });
  return Object.assign(() => statement(), {
    url,
    unsafe: statement,
    begin: async (fn: (tx: unknown) => unknown) => fn(client()),
    reserve: async () => Object.assign(client(), { release: () => undefined }),
    end: () => {
      ended.push(url);
      return Promise.resolve();
    },
  }) as unknown as Sql;
}

/** A refused connection, as the driver rejects a statement with it. Its
 * message names the host and port; a report must not. */
function refused(): Error {
  return Object.assign(new Error('connect ECONNREFUSED 10.1.2.3:5433'), {
    code: 'ECONNREFUSED',
    errno: -111,
    address: '10.1.2.3',
    port: 5433,
  });
}

describe('a knowledge transaction', () => {
  beforeEach(() => {
    answer = () => [];
    setPoolFactory(settlingPool);
  });

  it('leaves what its callback threw from elsewhere with its own origin', async () => {
    // A knowledge transaction can read the platform's database inside its
    // callback (`clearMailStampRows`): the platform's restart stays the
    // platform's.
    const restart = Object.assign(new Error('terminating connection'), {
      code: '57P01',
    });
    const sql = getKnowledgePool();
    const error = await failure(
      sql.begin(async () => {
        throw restart;
      }),
    );
    expect(error).toBe(restart);
    expect(knowledgeDatabaseUnavailable(error)).toBeNull();
    expect(isDatabaseUnavailable(error)).toBe(true);
  });

  it('marks a statement of its own that failed', async () => {
    const sql = getKnowledgePool();
    answer = refused;
    const error = await failure(sql.begin((tx) => tx`SELECT 1`));
    expect(knowledgeDatabaseUnavailable(error)).toBe('deployment');
  });
});

describe('a knowledge database outage [KNOW-R20]', () => {
  let reports: KnowledgeOutage[];
  let warned: string[];
  let logged: string[];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(0);
    answer = () => [];
    setPoolFactory(settlingPool);
    reports = [];
    setKnowledgeOutageReporter((outage) => reports.push(outage));
    warned = [];
    logged = [];
    vi.spyOn(console, 'warn').mockImplementation((line: unknown) => {
      warned.push(String(line));
    });
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      logged.push(String(line));
    });
  });

  async function failAt(sql: Sql, at: number): Promise<void> {
    vi.setSystemTime(at);
    answer = refused;
    await failure(sql`SELECT 1`);
  }

  it('is reported once it outlasts a routine restart, without the connection, and ends observably', async () => {
    writeConnection('acme', {
      host: '10.1.2.3',
      port: 5433,
      database: 'acme_knowledge',
      user: 'acme_user',
      sslmode: 'require',
    });
    const sql = await getKnowledgePoolForOrg('acme');

    await failAt(sql, 0);
    await failAt(sql, 30_000);
    expect(reports).toEqual([]);
    expect(warned).toEqual([
      expect.stringContaining(
        'the knowledge database of organization "acme" is not answering',
      ),
    ]);

    await failAt(sql, 61_000);
    await failAt(sql, 62_000);
    expect(reports).toEqual([
      {
        database: 'organization',
        orgSlug: 'acme',
        code: 'ECONNREFUSED',
        outageMs: 61_000,
      },
    ]);
    expect(JSON.stringify(reports)).not.toMatch(
      /10\.1\.2\.3|5433|acme_user|acme_knowledge|SELECT/,
    );
    expect(warned).toHaveLength(2);

    vi.setSystemTime(75_000);
    answer = () => [];
    await sql`SELECT 1`;
    expect(logged).toContainEqual(
      expect.stringContaining(
        'the knowledge database of organization "acme" is answering again after 75s',
      ),
    );

    // The next outage is a new one, reported in its own right.
    await failAt(sql, 100_000);
    await failAt(sql, 161_000);
    expect(reports).toHaveLength(2);
    expect(reports[1]).toMatchObject({ outageMs: 61_000 });
  });

  it('names no organization for the deployment database', async () => {
    const sql = getKnowledgePool();
    await failAt(sql, 0);
    await failAt(sql, 60_000);
    expect(reports).toEqual([
      { database: 'deployment', code: 'ECONNREFUSED', outageMs: 60_000 },
    ]);
    expect(warned[0]).toContain(
      'the deployment’s knowledge database is not answering',
    );
  });

  it('is not what a statement the database refused is', async () => {
    // A missing table, a rejected password: the database answered.
    const sql = getKnowledgePool();
    for (const at of [0, 61_000]) {
      vi.setSystemTime(at);
      answer = () =>
        Object.assign(new Error('relation "chunks" does not exist'), {
          code: '42P01',
        });
      const error = await failure(sql`SELECT 1`);
      expect(knowledgeDatabaseUnavailable(error)).toBeNull();
    }
    expect(reports).toEqual([]);
    expect(warned).toEqual([]);
  });

  it('keeps a reporter that throws out of the driver', async () => {
    setKnowledgeOutageReporter(() => {
      throw new Error('ingest down');
    });
    const sql = getKnowledgePool();
    await failAt(sql, 0);
    await failAt(sql, 60_000);
    expect(warned).toContainEqual(
      expect.stringContaining(
        'could not report a knowledge database outage: ingest down',
      ),
    );
  });
});

describe('a misconfigured own database fails closed', () => {
  it('refuses rather than falling back to the shared database [KNOW-R2]', async () => {
    writeConnection('acme', { host: 'acme-db.example.com' });

    await expect(getKnowledgePoolForOrg('acme')).rejects.toThrow(
      /invalid knowledge connection config/i,
    );
    // The whole point: no silent write into the shared corpus.
    expect(opened).toEqual([]);
  });

  it('refuses a connection file that is not JSON', async () => {
    const dir = path.join(configRoot, 'acme', 'knowledge');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'connection.json'), '{ not json');

    await expect(getKnowledgePoolForOrg('acme')).rejects.toThrow(
      /not valid JSON/,
    );
    expect(opened).toEqual([]);
  });

  it('refuses a host carrying URL metacharacters', async () => {
    // A host that could smuggle libpq parameters would let a configuration
    // change the connection's meaning, up to and including downgrading TLS.
    writeConnection('acme', {
      host: 'evil.example.com/?sslmode=disable&host=other',
      port: 5432,
      database: 'k',
      user: 'u',
      sslmode: 'require',
    });
    await expect(getKnowledgePoolForOrg('acme')).rejects.toThrow(
      /invalid knowledge connection config/i,
    );
    expect(opened).toEqual([]);
  });

  it('refuses an invalid organization slug before touching the filesystem', async () => {
    await expect(getKnowledgePoolForOrg('../../etc')).rejects.toThrow(
      /Invalid organization slug/,
    );
  });
});

describe('resolution caching', () => {
  it('reuses a resolved database for a short window', async () => {
    writeConnection('acme', {
      host: 'first.example.com',
      port: 5432,
      database: 'k',
      user: 'u',
      sslmode: 'require',
    });
    const first = await resolveOrgUrl('acme');

    writeConnection('acme', {
      host: 'second.example.com',
      port: 5432,
      database: 'k',
      user: 'u',
      sslmode: 'require',
    });
    expect(await resolveOrgUrl('acme')).toBe(first);

    invalidateOrgUrl('acme');
    expect(await resolveOrgUrl('acme')).toContain('second.example.com');
  });
});

describe('the keyword index capability', () => {
  function probingPool(result: 'present' | 'absent' | 'error'): Sql {
    const sql = (() => {
      if (result === 'error')
        return Promise.reject(new Error('connection lost'));
      return Promise.resolve(result === 'present' ? [{ '?column?': 1 }] : []);
    }) as unknown as Sql;
    return sql;
  }

  it('reports an index that is there', async () => {
    expect(await bm25Available(probingPool('present'))).toBe(true);
  });

  it('reports an index that is missing', async () => {
    expect(await bm25Available(probingPool('absent'))).toBe(false);
  });

  it('assumes the index is present when the probe itself fails', async () => {
    // A transient connection error must never be mistaken for a missing
    // extension and silently downgrade a healthy ParadeDB to vector-only for
    // the rest of the process.
    const sql = probingPool('error');
    expect(await bm25Available(sql)).toBe(true);
  });

  it('does not cache a failed probe', async () => {
    let calls = 0;
    const sql = (() => {
      calls++;
      return calls === 1
        ? Promise.reject(new Error('connection lost'))
        : Promise.resolve([{ '?column?': 1 }]);
    }) as unknown as Sql;
    expect(await bm25Available(sql)).toBe(true);
    expect(await bm25Available(sql)).toBe(true);
    expect(calls).toBe(2);
  });

  it('remembers a database the search leg found unusable', async () => {
    const sql = probingPool('present');
    expect(await bm25Available(sql)).toBe(true);
    markBm25Unavailable(sql);
    expect(await bm25Available(sql)).toBe(false);
  });
});

describe('the deployment default connection string', () => {
  it('comes from the environment when set', () => {
    expect(defaultKnowledgeUrl()).toBe(DEFAULT_URL);
  });

  it('falls back to the bundled database otherwise', () => {
    delete process.env.KNOWLEDGE_DATABASE_URL;
    process.env.DB_PASSWORD = 'secret';
    expect(defaultKnowledgeUrl()).toBe(
      'postgresql://tale:secret@knowledge-db:5432/tale_knowledge',
    );
    process.env.KNOWLEDGE_DATABASE_URL = DEFAULT_URL;
  });
});

describe('connection-failure classification', () => {
  /**
   * The distinction under test: a connection-class failure means the database
   * itself is unreachable, so recording anything INTO it is futile — the
   * crawl engine must record on the Convex row instead. Misclassifying a
   * statement error as connection-class would hide real scan bugs from the
   * corpus-side status; missing a connection error re-creates
   * TALE-PROJECT-106 (an uncaught auth failure retried forever).
   */
  function withCode(code: string): Error {
    return Object.assign(new Error(`failure carrying ${code}`), { code });
  }

  it('classifies the failures that mean the database is unreachable', () => {
    // Server-reported SQLSTATEs: a rotated credential, connection
    // exceptions, a missing database, a server refusing connections.
    for (const code of [
      '28P01',
      '28000',
      '08006',
      '08001',
      '08P01',
      '3D000',
      '57P03',
    ]) {
      expect(isConnectionFailure(withCode(code)), code).toBe(true);
    }
    // Below the protocol: postgres.js lifecycle codes and the Node system
    // errors that surface through it.
    for (const code of [
      'CONNECT_TIMEOUT',
      'CONNECTION_CLOSED',
      'CONNECTION_ENDED',
      'ECONNREFUSED',
      'ECONNRESET',
      'ENOTFOUND',
      'EAI_AGAIN',
      'ETIMEDOUT',
    ]) {
      expect(isConnectionFailure(withCode(code)), code).toBe(true);
    }
  });

  it('leaves statement-level failures alone — the database answered', () => {
    // An FK violation (the Jul 18 website_urls incident), missing
    // tables/columns mid-migration, syntax errors, index limits, corruption:
    // all failures OF a statement, all recordable in the corpus itself.
    for (const code of ['23503', '42P01', '42703', '42601', '54000', 'XX000']) {
      expect(isConnectionFailure(withCode(code)), code).toBe(false);
    }
  });

  it('never classifies an error that carries no code', () => {
    expect(isConnectionFailure(new Error('boom'))).toBe(false);
    expect(isConnectionFailure('password authentication failed')).toBe(false);
    expect(isConnectionFailure(null)).toBe(false);
    expect(isConnectionFailure(undefined)).toBe(false);
  });
});

describe('the corpus health hook', () => {
  afterEach(() => {
    setCorpusBootstrapHook(null);
  });

  it('runs once inside an own database bootstrap, never for the shared one', async () => {
    const seen: { url: string; orgSlug: string }[] = [];
    setCorpusBootstrapHook((event) => {
      seen.push(event);
      return Promise.resolve();
    });
    writeConnection('acme', {
      host: 'acme-db.example.com',
      port: 5432,
      database: 'acme_knowledge',
      user: 'acme',
      sslmode: 'require',
    });

    // The shared database is never bootstrapped here, so the hook never sees
    // it — its own boot step verifies it.
    await getKnowledgePoolForOrg('startup');
    expect(seen).toEqual([]);

    await getKnowledgePoolForOrg('acme');
    await getKnowledgePoolForOrg('acme');
    expect(seen).toHaveLength(1);
    expect(seen[0]?.orgSlug).toBe('acme');
    expect(seen[0]?.url).toContain('acme-db.example.com');
    expect(seen[0]?.url).not.toBe(DEFAULT_URL);
  });

  it('a failing hook never fails the bootstrap — the corpus stays usable', async () => {
    setCorpusBootstrapHook(() =>
      Promise.reject(new Error('the verifier exploded')),
    );
    writeConnection('globex', {
      host: 'globex-db.example.com',
      port: 5432,
      database: 'globex_knowledge',
      user: 'globex',
      sslmode: 'require',
    });

    const sql = await getKnowledgePoolForOrg('globex');
    expect(urlOf(sql)).toContain('globex-db.example.com');
  });
});
