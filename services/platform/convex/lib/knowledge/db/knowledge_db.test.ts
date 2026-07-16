import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface FakePool {
  __url: string;
  end: ReturnType<typeof vi.fn>;
  unsafe: ReturnType<typeof vi.fn>;
}

// Fake postgres.js: every `postgres(url)` call yields a distinct pool object
// that records its URL + spies on `unsafe`/`end`. Hoisted so `vi.mock` can wire
// it as the default export.
const { postgresMock, created } = vi.hoisted(() => {
  const pools: FakePool[] = [];
  const factory = vi.fn((url: string): FakePool => {
    const pool: FakePool = {
      __url: url,
      end: vi.fn().mockResolvedValue(undefined),
      unsafe: vi.fn(() => ({ simple: () => Promise.resolve([]) })),
    };
    pools.push(pool);
    return pool;
  });
  return { postgresMock: factory, created: pools };
});

vi.mock('postgres', () => ({ default: postgresMock }));

import {
  bm25Available,
  closeKnowledgePool,
  getKnowledgeDatabaseUrl,
  getKnowledgePool,
  getKnowledgePoolForOrg,
  isUndefinedFunction,
  isUndefinedSchema,
  markBm25Unavailable,
} from './knowledge_db';

/** The pools are fakes; view them as `FakePool` to read the recorded spies. */
function spy(pool: Sql): FakePool {
  return pool as unknown as FakePool;
}

const DEFAULT_URL = 'postgresql://tale:pw@knowledge-db:5432/tale_knowledge';

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(tmpdir(), 'knowledge-db-'));
  vi.stubEnv('TALE_CONFIG_DIR', tmpRoot);
  vi.stubEnv('KNOWLEDGE_DATABASE_URL', DEFAULT_URL);
  vi.stubEnv('SOPS_AGE_KEY', '');
  vi.stubEnv('SOPS_AGE_KEY_FILE', '');
});

afterEach(async () => {
  await closeKnowledgePool();
  postgresMock.mockClear();
  created.length = 0;
  vi.unstubAllEnvs();
  await rm(tmpRoot, { recursive: true, force: true });
});

async function writeOrgConnection(
  orgSlug: string,
  conn: Record<string, unknown>,
): Promise<void> {
  const dir = path.join(tmpRoot, orgSlug, 'knowledge');
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'connection.json'),
    JSON.stringify({ database: 'rag', user: 'u', sslmode: 'require', ...conn }),
  );
}

describe('knowledge-db pool cache', () => {
  it('getKnowledgePool returns one shared default pool', () => {
    const a = getKnowledgePool();
    const b = getKnowledgePool();
    expect(a).toBe(b);
    expect(getKnowledgeDatabaseUrl()).toBe(DEFAULT_URL);
    expect(postgresMock).toHaveBeenCalledTimes(1);
    expect(postgresMock).toHaveBeenCalledWith(DEFAULT_URL, expect.anything());
  });

  it('falls back to the default pool when an org has no per-org config', async () => {
    const def = getKnowledgePool();
    const orgPool = await getKnowledgePoolForOrg('no-config-org');
    expect(orgPool).toBe(def);
    // No second pool created — the org shares the default.
    expect(postgresMock).toHaveBeenCalledTimes(1);
  });

  it('keys pools by connection string: same URL → same pool', async () => {
    await writeOrgConnection('org-a', { host: 'shared.db.example' });
    await writeOrgConnection('org-b', { host: 'shared.db.example' });
    const poolA = await getKnowledgePoolForOrg('org-a');
    const poolB = await getKnowledgePoolForOrg('org-b');
    expect(poolA).toBe(poolB);
    // One BYO pool (shared) — never one-pool-per-org.
    const byoPools = created.filter((p) => p.__url !== DEFAULT_URL);
    expect(byoPools).toHaveLength(1);
  });

  it('different connection strings → different pools', async () => {
    await writeOrgConnection('org-a', { host: 'a.db.example' });
    await writeOrgConnection('org-c', { host: 'c.db.example' });
    const poolA = await getKnowledgePoolForOrg('org-a');
    const poolC = await getKnowledgePoolForOrg('org-c');
    expect(poolA).not.toBe(poolC);
    expect(spy(poolA).__url).toContain('a.db.example');
    expect(spy(poolC).__url).toContain('c.db.example');
  });

  it('bootstraps the schema for a BYO pool but not the default pool', async () => {
    const def = getKnowledgePool();
    await writeOrgConnection('org-a', { host: 'a.db.example' });
    const byo = await getKnowledgePoolForOrg('org-a');
    // Default pool never runs bootstrap DDL (its schema is applied at startup).
    expect(spy(def).unsafe).not.toHaveBeenCalled();
    // BYO pool bootstraps its private_knowledge schema exactly once.
    expect(spy(byo).unsafe).toHaveBeenCalledTimes(1);
    // Re-resolving does not re-bootstrap (once per connection string).
    await getKnowledgePoolForOrg('org-a');
    expect(spy(byo).unsafe).toHaveBeenCalledTimes(1);
  });

  it('closeKnowledgePool closes every cached pool', async () => {
    const def = getKnowledgePool();
    await writeOrgConnection('org-a', { host: 'a.db.example' });
    const byo = await getKnowledgePoolForOrg('org-a');
    await closeKnowledgePool();
    expect(spy(def).end).toHaveBeenCalledTimes(1);
    expect(spy(byo).end).toHaveBeenCalledTimes(1);
    // After close, the next acquisition recreates the pool.
    postgresMock.mockClear();
    getKnowledgePool();
    expect(postgresMock).toHaveBeenCalledTimes(1);
  });
});

describe('BM25 capability probe', () => {
  /** Callable fake Sql: the tagged-template probe hits the function itself. */
  function makeProbeSql(behavior: () => Promise<unknown[]>): {
    sql: Sql;
    calls: { count: number };
  } {
    const calls = { count: 0 };
    const fn = (async () => {
      calls.count += 1;
      return behavior();
    }) as unknown as Sql;
    return { sql: fn, calls };
  }

  it('probes pg_extension once per pool and caches a negative answer', async () => {
    const { sql, calls } = makeProbeSql(async () => []);
    await expect(bm25Available(sql)).resolves.toBe(false);
    await expect(bm25Available(sql)).resolves.toBe(false);
    expect(calls.count).toBe(1);
  });

  it('caches a positive answer', async () => {
    const { sql, calls } = makeProbeSql(async () => [{ '?column?': 1 }]);
    await expect(bm25Available(sql)).resolves.toBe(true);
    await expect(bm25Available(sql)).resolves.toBe(true);
    expect(calls.count).toBe(1);
  });

  it('assumes available on a failed probe and does not cache it', async () => {
    let attempts = 0;
    const { sql, calls } = makeProbeSql(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('connection refused');
      }
      return [];
    });
    // Failed probe → optimistic true, uncached.
    await expect(bm25Available(sql)).resolves.toBe(true);
    // Next call re-probes and lands the real (negative) answer.
    await expect(bm25Available(sql)).resolves.toBe(false);
    expect(calls.count).toBe(2);
  });

  it('markBm25Unavailable overrides the cached capability', async () => {
    const { sql, calls } = makeProbeSql(async () => [{ '?column?': 1 }]);
    await expect(bm25Available(sql)).resolves.toBe(true);
    markBm25Unavailable(sql);
    await expect(bm25Available(sql)).resolves.toBe(false);
    expect(calls.count).toBe(1);
  });
});

describe('pg SQLSTATE helpers', () => {
  function pgError(code: string, message: string): Error {
    return Object.assign(new Error(message), { code });
  }

  it('isUndefinedSchema matches 3F000 (schema "paradedb" does not exist)', () => {
    expect(
      isUndefinedSchema(pgError('3F000', 'schema "paradedb" does not exist')),
    ).toBe(true);
    expect(isUndefinedSchema(pgError('42P01', 'no table'))).toBe(false);
    expect(isUndefinedSchema(new Error('plain'))).toBe(false);
  });

  it('isUndefinedFunction matches 42883', () => {
    expect(
      isUndefinedFunction(
        pgError('42883', 'operator does not exist: uuid @@@ text'),
      ),
    ).toBe(true);
    expect(isUndefinedFunction(pgError('3F000', 'schema'))).toBe(false);
  });
});
