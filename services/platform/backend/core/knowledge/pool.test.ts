// @vitest-environment node

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  bm25Available,
  closeKnowledgePools,
  defaultKnowledgeUrl,
  getKnowledgePool,
  getKnowledgePoolForOrg,
  invalidateOrgUrl,
  isConnectionFailure,
  markBm25Unavailable,
  resolveOrgUrl,
  setCorpusBootstrapHook,
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
let previousConfigDir: string | undefined;
let previousDatabaseUrl: string | undefined;

/** A pool double that records nothing but its connection string. */
function stubPool(url: string): Sql {
  opened.push(url);
  const sql = ((..._args: unknown[]) =>
    Promise.resolve([])) as unknown as Sql & {
    url: string;
  };
  sql.url = url;
  sql.end = () => Promise.resolve();
  sql.unsafe = () => Promise.resolve([]) as never;
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
  previousConfigDir = process.env.TALE_CONFIG_DIR;
  previousDatabaseUrl = process.env.KNOWLEDGE_DATABASE_URL;
  process.env.TALE_CONFIG_DIR = configRoot;
  process.env.KNOWLEDGE_DATABASE_URL = DEFAULT_URL;
  setPoolFactory(stubPool);
});

afterEach(async () => {
  await closeKnowledgePools();
  setPoolFactory(null);
  rmSync(configRoot, { recursive: true, force: true });
  if (previousConfigDir === undefined) delete process.env.TALE_CONFIG_DIR;
  else process.env.TALE_CONFIG_DIR = previousConfigDir;
  if (previousDatabaseUrl === undefined)
    delete process.env.KNOWLEDGE_DATABASE_URL;
  else process.env.KNOWLEDGE_DATABASE_URL = previousDatabaseUrl;
});

describe('the tenant chokepoint', () => {
  it('routes an organization with its own database away from the shared one', async () => {
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

  it('never lets one organization reach another organization corpus', async () => {
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

  it('gives an organization without its own database the deployment default', async () => {
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

describe('a misconfigured own database fails closed', () => {
  it('refuses rather than falling back to the shared database', async () => {
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
