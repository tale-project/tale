// @vitest-environment node

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeKnowledgePools, setPoolFactory } from '../knowledge/pool';
import {
  deleteKnowledgeDocumentsBatch,
  listKnowledgeDocumentRefs,
} from './knowledge_delete';

/**
 * The purge and the index must agree on WHICH database holds an
 * organization's corpus. These tests stub the pool factory — the same seam
 * `pool.test.ts` uses — and record every statement per connection string, so
 * "the purge hit the database the indexer writes to" is a statement about
 * observed calls, not about code reading.
 *
 * The routing rules themselves (BYO database, cross-org isolation) are
 * `pool.ts`'s and are tested there; here the claim is only that this module
 * defers to that resolver instead of carrying a second one.
 */

const DEFAULT_URL = 'postgresql://tale:pw@knowledge-db:5432/tale_knowledge';
const STRAY_URL = 'postgresql://tale:pw@db:5432/tale_knowledge';

interface Statement {
  url: string;
  text: string;
  params: unknown[];
}

let configRoot: string;
let opened: string[];
let statements: Statement[];
let previousConfigDir: string | undefined;
let previousDatabaseUrl: string | undefined;
let previousRagUrl: string | undefined;

/** A pool double that answers one document row and records its statements. */
function stubPool(url: string): Sql {
  opened.push(url);
  const unsafe = (text: string, params: unknown[] = []) => {
    statements.push({ url, text, params });
    if (text.startsWith('SELECT id ')) {
      return Promise.resolve([{ id: 'doc-1' }]);
    }
    if (text.startsWith('SELECT DISTINCT file_id')) {
      return Promise.resolve([{ fileId: 'ref-a' }, { fileId: 'ref-b' }]);
    }
    return Promise.resolve([]);
  };
  const sql = ((..._args: unknown[]) =>
    Promise.resolve([])) as unknown as Sql & { url: string };
  sql.url = url;
  sql.end = () => Promise.resolve();
  sql.unsafe = unsafe as never;
  // The corpus bootstrap holds its advisory lock on one reserved connection
  // (`applyCorpusSchema` → `sql.reserve()`); the double answers it with the
  // same recording surface, as the pool double does.
  sql.reserve = (() =>
    Promise.resolve({
      unsafe,
      release: () => undefined,
    })) as unknown as Sql['reserve'];
  sql.begin = ((fn: (tx: Sql) => Promise<unknown>) =>
    fn({ unsafe } as unknown as Sql)) as never;
  return sql;
}

function writeConnection(orgSlug: string, connection: unknown): void {
  const dir = path.join(configRoot, orgSlug, 'knowledge');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, 'connection.json'),
    JSON.stringify(connection, null, 2),
  );
}

beforeEach(() => {
  configRoot = mkdtempSync(path.join(tmpdir(), 'knowledge-delete-'));
  opened = [];
  statements = [];
  previousConfigDir = process.env.TALE_CONFIG_DIR;
  previousDatabaseUrl = process.env.KNOWLEDGE_DATABASE_URL;
  previousRagUrl = process.env.RAG_DATABASE_URL;
  process.env.TALE_CONFIG_DIR = configRoot;
  process.env.KNOWLEDGE_DATABASE_URL = DEFAULT_URL;
  // The retired alias — the shipped entrypoint used to export it with the
  // operational host, and only the purge resolver ever read it.
  process.env.RAG_DATABASE_URL = STRAY_URL;
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
  if (previousRagUrl === undefined) delete process.env.RAG_DATABASE_URL;
  else process.env.RAG_DATABASE_URL = previousRagUrl;
});

describe('deleteKnowledgeDocumentsBatch', () => {
  it('purges from the pool the indexer writes to, never the RAG_DATABASE_URL alias', async () => {
    const result = await deleteKnowledgeDocumentsBatch({
      orgSlug: 'acme',
      fileIds: ['ref-a'],
    });

    expect(result).toEqual({
      success: true,
      deleted_count: 1,
      failed_file_ids: [],
    });
    expect(opened).toEqual([DEFAULT_URL]);
    expect(opened).not.toContain(STRAY_URL);
    expect(statements.map((s) => s.url)).toEqual([
      DEFAULT_URL,
      DEFAULT_URL,
      DEFAULT_URL,
    ]);
    expect(
      statements.map((s) => s.text.split(' ').slice(0, 3).join(' ')),
    ).toEqual([
      'SELECT id FROM',
      'DELETE FROM private_knowledge.chunks',
      'DELETE FROM private_knowledge.documents',
    ]);
    // Every statement is scoped to the organization.
    for (const statement of statements) {
      expect(statement.params[0]).toBe('acme');
    }
  });

  it('follows an organization with its own database, like the indexer does', async () => {
    writeConnection('acme', {
      host: 'acme-db.example.com',
      port: 5432,
      database: 'acme_knowledge',
      user: 'acme',
      sslmode: 'require',
    });

    await deleteKnowledgeDocumentsBatch({
      orgSlug: 'acme',
      fileIds: ['ref-a'],
    });

    expect(opened).toHaveLength(1);
    expect(opened[0]).toContain('acme-db.example.com');
    expect(opened).not.toContain(DEFAULT_URL);
    expect(opened).not.toContain(STRAY_URL);
  });

  it('is a no-op success for an empty batch and opens nothing', async () => {
    const result = await deleteKnowledgeDocumentsBatch({
      orgSlug: 'acme',
      fileIds: [],
    });

    expect(result).toEqual({
      success: true,
      deleted_count: 0,
      failed_file_ids: [],
    });
    expect(opened).toEqual([]);
  });
});

describe('listKnowledgeDocumentRefs', () => {
  it('walks the same pool the purge uses', async () => {
    const page = await listKnowledgeDocumentRefs({
      orgSlug: 'acme',
      afterFileId: null,
      limit: 100,
    });

    expect(page).toEqual(['ref-a', 'ref-b']);
    expect(opened).toEqual([DEFAULT_URL]);
    expect(statements).toHaveLength(1);
    expect(statements[0]?.params).toEqual(['acme', null, 100]);
  });
});
