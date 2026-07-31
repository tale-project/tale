// @vitest-environment node

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applyCorpusSchema,
  corpusSchemaSql,
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

  it('reads one statement block per corpus', () => {
    delete process.env.KNOWLEDGE_MIGRATIONS_DIR;
    expect(corpusSchemaSql().length).toBeGreaterThanOrEqual(2);
  });

  it('declares both corpora and their chunk tables', () => {
    delete process.env.KNOWLEDGE_MIGRATIONS_DIR;
    const all = corpusSchemaSql().join('\n');
    expect(all).toContain('CREATE SCHEMA IF NOT EXISTS private_knowledge');
    expect(all).toContain('CREATE SCHEMA IF NOT EXISTS public_web');
    expect(all).toContain('private_knowledge.chunks');
    expect(all).toContain('public_web.chunks');
  });

  it('declares the columns retrieval and reassembly depend on', () => {
    // If a migration ever loses one of these, retrieval breaks in a way that
    // looks like bad search results rather than like a missing column.
    delete process.env.KNOWLEDGE_MIGRATIONS_DIR;
    const all = corpusSchemaSql().join('\n');
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

  it('never applies a down migration', () => {
    // Applying whatever follows the down marker to a populated corpus would be
    // a loaded gun; the bootstrap only ever runs the up half.
    delete process.env.KNOWLEDGE_MIGRATIONS_DIR;
    for (const statement of corpusSchemaSql()) {
      expect(statement).not.toContain('migrate:down');
      expect(statement).not.toMatch(/DROP SCHEMA(?!\s+.*--)/i);
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
      const statements = corpusSchemaSql();
      expect(statements).toEqual([
        'CREATE SCHEMA IF NOT EXISTS private_knowledge;',
        'CREATE SCHEMA IF NOT EXISTS public_web;',
      ]);
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

describe('applyCorpusSchema — operator-prepared databases', () => {
  it('skips preparation when both corpora already carry their tables', async () => {
    const executed: string[] = [];
    const sql = {
      unsafe: async (statement: string) => {
        executed.push(statement);
        if (statement.includes('information_schema.tables')) {
          return [{ n: '3' }];
        }
        throw new Error('nothing else should run');
      },
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- minimal Sql facade for the probe path
    } as unknown as Parameters<typeof applyCorpusSchema>[0];

    await applyCorpusSchema(sql);

    expect(executed).toHaveLength(1);
  });
});
