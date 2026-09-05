// @vitest-environment node

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applyCorpusSchema,
  corpusMigrations,
  findMigrationsDir,
  upSection,
} from './ddl';

/**
 * The bootstrap that prepares an organization's own database reads the SAME
 * migration files the bundled database is built from. These tests read the real
 * files — a stand-in would defeat the point, which is that there is exactly one
 * declaration of the corpus schema and this code uses it.
 */

let previousDir: string | undefined;

beforeEach(() => {
  previousDir = process.env.KNOWLEDGE_MIGRATIONS_DIR;
});

afterEach(() => {
  if (previousDir === undefined) delete process.env.KNOWLEDGE_MIGRATIONS_DIR;
  else process.env.KNOWLEDGE_MIGRATIONS_DIR = previousDir;
});

describe('the real migrations are what gets applied', () => {
  it('finds them in the repository', () => {
    delete process.env.KNOWLEDGE_MIGRATIONS_DIR;
    expect(findMigrationsDir()).not.toBeNull();
  });

  it('reads the baseline and the converging migration of each corpus', () => {
    delete process.env.KNOWLEDGE_MIGRATIONS_DIR;
    const migrations = corpusMigrations();
    for (const schema of ['private_knowledge', 'public_web']) {
      expect(
        migrations.filter((m) => m.schema === schema).length,
      ).toBeGreaterThanOrEqual(2);
    }
  });

  it('keys every file on the numeric version dbmate ledgers use', () => {
    delete process.env.KNOWLEDGE_MIGRATIONS_DIR;
    const versions = corpusMigrations().map((m) => m.version);
    for (const version of versions) {
      expect(version).toMatch(/^\d+$/);
    }
    // Ledger identity: within a schema a version can be recorded only once.
    expect(new Set(versions).size).toBe(versions.length);
  });

  it('declares both corpora and their chunk tables', () => {
    delete process.env.KNOWLEDGE_MIGRATIONS_DIR;
    const all = corpusMigrations()
      .map((m) => m.sql)
      .join('\n');
    expect(all).toContain('CREATE SCHEMA IF NOT EXISTS private_knowledge');
    expect(all).toContain('CREATE SCHEMA IF NOT EXISTS public_web');
    expect(all).toContain('private_knowledge.chunks');
    expect(all).toContain('public_web.chunks');
  });

  it('declares the columns retrieval and reassembly depend on', () => {
    // If a migration ever loses one of these, retrieval breaks in a way that
    // looks like bad search results rather than like a missing column.
    //
    // The scope columns are checked in the case below instead: a substring
    // search over the joined SQL also matches these files' prose, so it would
    // pass on a migration that only TALKS about `conversation_id`.
    delete process.env.KNOWLEDGE_MIGRATIONS_DIR;
    const all = corpusMigrations()
      .map((m) => m.sql)
      .join('\n');
    for (const column of [
      'context_header',
      'core_content',
      'prefix_overlap',
      'suffix_overlap',
      'org_slug',
      'content_hash',
    ]) {
      expect(all).toContain(column);
    }
  });

  it('converges the chunk context columns outside the baseline too', () => {
    // The regression this guards: `context_header` was added to the
    // already-applied baseline, which a ledgered database never re-runs, so
    // every chunk INSERT failed with "column does not exist". Each corpus must
    // carry the convergence in a migration that is NOT its first (baseline)
    // version.
    delete process.env.KNOWLEDGE_MIGRATIONS_DIR;
    const migrations = corpusMigrations();
    for (const schema of ['private_knowledge', 'public_web']) {
      const later = migrations.filter((m) => m.schema === schema).slice(1);
      expect(
        later.some((m) =>
          m.sql.includes('ADD COLUMN IF NOT EXISTS context_header'),
        ),
      ).toBe(true);
    }
  });

  it('adds each scope column outside the private_knowledge baseline', () => {
    // Same regression class as the chunk-context convergence, with a worse
    // failure mode: a ledgered database never re-runs its baseline, so a scope
    // column declared only there is absent in production while the code filters
    // on it — the statement errors, and a failing retrieval reads as "no
    // results" rather than as a broken deployment.
    delete process.env.KNOWLEDGE_MIGRATIONS_DIR;
    const later = corpusMigrations()
      .filter((m) => m.schema === 'private_knowledge')
      .slice(1);
    for (const column of [
      'team_id',
      'project_id',
      'team_ids',
      'conversation_id',
    ]) {
      expect(
        later.some((m) => m.sql.includes(`ADD COLUMN IF NOT EXISTS ${column}`)),
      ).toBe(true);
    }
  });

  it('carries the url-list source columns outside the public_web baseline', () => {
    // Same regression class as the chunk-context convergence: these columns
    // postdate the applied baseline, so they must arrive in their own
    // migration or an already-migrated database never receives them.
    delete process.env.KNOWLEDGE_MIGRATIONS_DIR;
    const later = corpusMigrations()
      .filter((m) => m.schema === 'public_web')
      .slice(1);
    expect(
      later.some((m) => m.sql.includes('ADD COLUMN IF NOT EXISTS kind')),
    ).toBe(true);
    expect(
      later.some((m) => m.sql.includes('ADD COLUMN IF NOT EXISTS listed')),
    ).toBe(true);
  });

  it('never applies a down migration', () => {
    // Applying whatever follows the down marker to a populated corpus would be
    // a loaded gun; the bootstrap only ever runs the up half.
    delete process.env.KNOWLEDGE_MIGRATIONS_DIR;
    for (const migration of corpusMigrations()) {
      expect(migration.sql).not.toContain('migrate:down');
      expect(migration.sql).not.toMatch(/DROP SCHEMA(?!\s+.*--)/i);
    }
  });

  it('follows the environment variable the database container already uses', () => {
    // One name for one thing: a second variable would be a second place to get
    // a deployment wrong.
    const dir = mkdtempSync(path.join(tmpdir(), 'knowledge-ddl-'));
    try {
      for (const schema of ['private_knowledge', 'public_web']) {
        mkdirSync(path.join(dir, schema), { recursive: true });
        writeFileSync(
          path.join(dir, schema, '001_test.sql'),
          `-- migrate:up\nCREATE SCHEMA IF NOT EXISTS ${schema};\n-- migrate:down\nDROP SCHEMA ${schema};\n`,
        );
      }
      process.env.KNOWLEDGE_MIGRATIONS_DIR = dir;
      expect(findMigrationsDir()).toBe(dir);
      expect(corpusMigrations()).toEqual([
        {
          schema: 'private_knowledge',
          version: '001',
          name: '001_test.sql',
          sql: 'CREATE SCHEMA IF NOT EXISTS private_knowledge;',
        },
        {
          schema: 'public_web',
          version: '001',
          name: '001_test.sql',
          sql: 'CREATE SCHEMA IF NOT EXISTS public_web;',
        },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a file it cannot ledger rather than guessing', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'knowledge-ddl-'));
    try {
      for (const schema of ['private_knowledge', 'public_web']) {
        mkdirSync(path.join(dir, schema), { recursive: true });
        writeFileSync(
          path.join(dir, schema, 'unversioned.sql'),
          '-- migrate:up\nSELECT 1;\n',
        );
      }
      process.env.KNOWLEDGE_MIGRATIONS_DIR = dir;
      expect(() => corpusMigrations()).toThrow(/numeric version/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('reading one migration file', () => {
  it('takes only the up half', () => {
    expect(
      upSection(
        '-- migrate:up\nCREATE TABLE a();\n-- migrate:down\nDROP TABLE a;',
      ),
    ).toBe('CREATE TABLE a();');
  });

  it('takes everything after the marker when there is no down half', () => {
    expect(upSection('-- migrate:up\nCREATE TABLE a();')).toBe(
      'CREATE TABLE a();',
    );
  });

  it('refuses a file with no up marker rather than guessing', () => {
    expect(() => upSection('CREATE TABLE a();')).toThrow(/migrate:up/);
  });
});

describe('applyCorpusSchema — version-aware application', () => {
  /**
   * A database facade that answers the ledger reads from `recorded`, records
   * every version INSERTed back into it (so a later reader sees an earlier
   * writer's ledger, as PostgreSQL would), records everything executed, and
   * serializes `pg_advisory_lock` holders the way the server does: a second
   * taker waits until the first unlocks.
   */
  function fakeSql(
    recorded: Record<string, string[]>,
    options: {
      /** Make the statement matching this fail — a migration file dying
       * midway in its own transaction. */
      failOn?: (statement: string) => boolean;
    } = {},
  ) {
    const executed: { statement: string; params?: unknown[] }[] = [];
    let lockHeld = false;
    const waiters: (() => void)[] = [];
    let reserved = 0;
    let released = 0;
    const unsafe = async (statement: string, params?: unknown[]) => {
      executed.push({ statement, params });
      if (options.failOn?.(statement)) {
        throw new Error(`relation "chunks" already exists`);
      }
      if (statement.includes('pg_advisory_lock(')) {
        if (lockHeld) {
          await new Promise<void>((resolve) => waiters.push(resolve));
        }
        lockHeld = true;
        return [];
      }
      if (statement.includes('pg_advisory_unlock(')) {
        lockHeld = false;
        waiters.shift()?.();
        return [];
      }
      for (const [schema, versions] of Object.entries(recorded)) {
        if (
          statement.includes(`SELECT version FROM ${schema}.schema_migrations`)
        ) {
          return versions.map((version) => ({ version }));
        }
        if (
          statement.includes(`INSERT INTO ${schema}.schema_migrations`) &&
          typeof params?.[0] === 'string'
        ) {
          versions.push(params[0]);
        }
      }
      if (statement.includes('information_schema.tables')) {
        return [{ n: '3' }];
      }
      return [];
    };
    const sql = {
      unsafe,
      reserve: async () => {
        reserved += 1;
        return {
          unsafe,
          release: () => {
            released += 1;
          },
        };
      },
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- minimal Sql facade for the ledger protocol
    } as unknown as Parameters<typeof applyCorpusSchema>[0];
    return {
      sql,
      executed,
      sessions: () => ({ reserved, released }),
    };
  }

  function versionsBySchema() {
    delete process.env.KNOWLEDGE_MIGRATIONS_DIR;
    const migrations = corpusMigrations();
    const of = (schema: string) =>
      migrations.filter((m) => m.schema === schema).map((m) => m.version);
    return {
      privateVersions: of('private_knowledge'),
      publicVersions: of('public_web'),
    };
  }

  function insertedVersions(
    executed: { statement: string; params?: unknown[] }[],
  ) {
    return executed
      .filter(({ statement }) => statement.includes('INSERT INTO'))
      .map(({ params }) => params?.[0]);
  }

  it('applies and records only what a ledgered database is missing', async () => {
    // The bundled database's ledgers know the baselines; everything after them
    // — the converging migrations a later release added — must be applied.
    const { privateVersions, publicVersions } = versionsBySchema();
    const { sql, executed } = fakeSql({
      private_knowledge: privateVersions.slice(0, 1),
      public_web: publicVersions.slice(0, 1),
    });

    await applyCorpusSchema(sql);

    const expected = [...privateVersions.slice(1), ...publicVersions.slice(1)];
    expect(insertedVersions(executed)).toEqual(expected);
    // The baselines themselves must not have been re-applied.
    expect(
      executed.some(({ statement }) =>
        statement.includes(
          'CREATE TABLE IF NOT EXISTS private_knowledge.documents',
        ),
      ),
    ).toBe(false);
  });

  it('applies nothing beyond the ledger protocol when up to date', async () => {
    const { privateVersions, publicVersions } = versionsBySchema();
    const { sql, executed } = fakeSql({
      private_knowledge: privateVersions,
      public_web: publicVersions,
    });

    await applyCorpusSchema(sql);

    expect(insertedVersions(executed)).toEqual([]);
    expect(
      executed.some(({ statement }) => statement.includes('ADD COLUMN')),
    ).toBe(false);
  });

  it('holds the bootstrap lock on one reserved connection for the whole apply', async () => {
    const { privateVersions, publicVersions } = versionsBySchema();
    const { sql, executed, sessions } = fakeSql({
      private_knowledge: privateVersions,
      public_web: publicVersions,
    });

    await applyCorpusSchema(sql);

    // The ledger is read only once the lock is held, and the lock is
    // released — and the connection returned — whatever happened in between.
    const order = executed.map(({ statement }) => statement);
    const lockAt = order.findIndex((s) => s.includes('pg_advisory_lock('));
    const firstRead = order.findIndex((s) => s.includes('SELECT version FROM'));
    const unlockAt = order.findIndex((s) => s.includes('pg_advisory_unlock('));
    expect(lockAt).toBeGreaterThanOrEqual(0);
    expect(lockAt).toBeLessThan(firstRead);
    expect(unlockAt).toBe(order.length - 1);
    expect(sessions()).toEqual({ reserved: 1, released: 1 });
  });

  it('rolls back a migration file that fails midway before releasing the lock and the connection', async () => {
    // A baseline file carries its own BEGIN … COMMIT. A statement failing
    // inside it leaves the reserved session in an aborted transaction, where
    // `pg_advisory_unlock` would fail too and the session-level lock would
    // return to the pool still held — every later bootstrap on that database
    // then waits forever. The ROLLBACK must come first, and the failure that
    // surfaces must be the migration's own.
    const { privateVersions } = versionsBySchema();
    const { sql, executed, sessions } = fakeSql(
      { private_knowledge: privateVersions, public_web: [] },
      {
        failOn: (statement) =>
          statement.includes('CREATE TABLE IF NOT EXISTS public_web.chunks'),
      },
    );

    await expect(applyCorpusSchema(sql)).rejects.toThrow(
      'relation "chunks" already exists',
    );

    const order = executed.map(({ statement }) => statement);
    const failedAt = order.findIndex((s) =>
      s.includes('CREATE TABLE IF NOT EXISTS public_web.chunks'),
    );
    const rollbackAt = order.indexOf('ROLLBACK');
    const unlockAt = order.findIndex((s) => s.includes('pg_advisory_unlock('));
    expect(failedAt).toBeGreaterThanOrEqual(0);
    expect(rollbackAt).toBe(failedAt + 1);
    expect(unlockAt).toBe(rollbackAt + 1);
    expect(unlockAt).toBe(order.length - 1);
    // The failed file is not recorded as applied.
    expect(insertedVersions(executed)).toEqual([]);
    expect(sessions()).toEqual({ reserved: 1, released: 1 });
  });

  it('serializes two processes bootstrapping the same fresh database', async () => {
    // The api and the worker both first-touch a fresh bring-your-own
    // database: without the lock both read an empty ledger and race the
    // same CREATEs, and the loser dies on a catalog unique violation.
    const { privateVersions, publicVersions } = versionsBySchema();
    const { sql, executed } = fakeSql({
      private_knowledge: [],
      public_web: [],
    });

    await Promise.all([applyCorpusSchema(sql), applyCorpusSchema(sql)]);

    // Every migration was applied exactly once — the second process found
    // the first's ledger — and no CREATE ran while the other held the lock.
    expect(insertedVersions(executed)).toEqual([
      ...privateVersions,
      ...publicVersions,
    ]);
    const baselines = executed.filter(({ statement }) =>
      statement.includes(
        'CREATE TABLE IF NOT EXISTS private_knowledge.documents',
      ),
    );
    expect(baselines).toHaveLength(1);
  });

  it('re-applies everything on a database bootstrapped before the ledger existed', async () => {
    // The old bootstrap recorded nothing. Every file re-applies — safe because
    // the migrations are idempotent — and the ledger is written so the next
    // run is cheap.
    const { privateVersions, publicVersions } = versionsBySchema();
    const { sql, executed } = fakeSql({
      private_knowledge: [],
      public_web: [],
    });

    await applyCorpusSchema(sql);

    expect(insertedVersions(executed)).toEqual([
      ...privateVersions,
      ...publicVersions,
    ]);
  });
});
