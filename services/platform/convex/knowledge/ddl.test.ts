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
  /** A Sql facade that answers the ledger reads from `recorded` and records
   * everything executed. */
  function fakeSql(recorded: Record<string, string[]>) {
    const executed: { statement: string; params?: unknown[] }[] = [];
    const sql = {
      unsafe: async (statement: string, params?: unknown[]) => {
        executed.push({ statement, params });
        for (const [schema, versions] of Object.entries(recorded)) {
          if (
            statement.includes(
              `SELECT version FROM ${schema}.schema_migrations`,
            )
          ) {
            return versions.map((version) => ({ version }));
          }
        }
        if (statement.includes('information_schema.tables')) {
          return [{ n: '3' }];
        }
        return [];
      },
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- minimal Sql facade for the ledger protocol
    } as unknown as Parameters<typeof applyCorpusSchema>[0];
    return { sql, executed };
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
