import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EmbeddingService } from '../../lib/knowledge/embedding/service';

/**
 * Regression guard for #2755: a BYO knowledge database WITHOUT `pg_search`
 * (any managed Postgres — Neon, RDS, …) must degrade to vector-only search.
 * Before the fix, `ftsSearch` unconditionally issued `paradedb.*` SQL and the
 * catch-all only recognized messages containing "bm25", so the real error —
 * `PostgresError: schema "paradedb" does not exist` (SQLSTATE 3F000) — escaped
 * and every chat knowledge search failed ("knowledge base temporarily
 * unavailable") even though indexing had succeeded.
 */

const hoisted = vi.hoisted(() => ({
  bm25Available: vi.fn<() => Promise<boolean>>(async () => true),
  markBm25Unavailable: vi.fn(),
}));

vi.mock('../../lib/knowledge/db/knowledge_db', () => {
  const code = (err: unknown): string =>
    err instanceof Error && 'code' in err && typeof err.code === 'string'
      ? err.code
      : '';
  return {
    PRIVATE_KNOWLEDGE_SCHEMA: 'private_knowledge',
    bm25Available: hoisted.bm25Available,
    markBm25Unavailable: hoisted.markBm25Unavailable,
    isUndefinedTable: (err: unknown) => code(err) === '42P01',
    isUndefinedColumn: (err: unknown) => code(err) === '42703',
    isUndefinedSchema: (err: unknown) => code(err) === '3F000',
    isUndefinedFunction: (err: unknown) => code(err) === '42883',
    isInternalError: (err: unknown) => code(err) === 'XX000',
    isDataCorrupted: (err: unknown) => code(err) === 'XX001',
  };
});

vi.mock('../../lib/knowledge/db/retry', () => ({
  withRetry: <T>(fn: () => Promise<T>) => fn(),
}));

import { RagSearchService } from './search_service';

interface FakeRow {
  id: string;
  chunk_content: string;
  core_content: string | null;
  chunk_index: number;
  document_id: string;
  file_id: string | null;
  filename: string | null;
  source_created_at: Date | null;
  source_modified_at: Date | null;
  created_at: Date | null;
  score: number;
}

function row(id: string, content: string, score: number): FakeRow {
  return {
    id,
    chunk_content: content,
    core_content: content,
    chunk_index: 0,
    document_id: 'doc-1',
    file_id: 'file-1',
    filename: 'doc.txt',
    source_created_at: null,
    source_modified_at: null,
    created_at: null,
    score,
  };
}

const isFts = (text: string): boolean => text.includes('paradedb.match');
const isVector = (text: string): boolean => text.includes('<=>');

function makeEmbedding(): EmbeddingService {
  return {
    embedQueryWithUsage: vi.fn(async () => ({
      embedding: [0.1, 0.2, 0.3],
      usage: { promptTokens: 1, totalTokens: 1, model: 'test-embed' },
    })),
    embedQuery: vi.fn(async () => [0.1, 0.2, 0.3]),
  } as unknown as EmbeddingService;
}

function pgError(sqlstate: string, message: string): Error {
  return Object.assign(new Error(message), { code: sqlstate });
}

beforeEach(() => {
  hoisted.bm25Available.mockReset();
  hoisted.bm25Available.mockResolvedValue(true);
  hoisted.markBm25Unavailable.mockClear();
});

describe('RagSearchService on a pg_search-less database (#2755)', () => {
  it('skips the BM25 leg entirely and returns vector-only results', async () => {
    hoisted.bm25Available.mockResolvedValue(false);
    const unsafe = vi.fn(async (text: string) =>
      isVector(text) ? [row('v1', 'vector hit', 0.9)] : [],
    );
    const sql = { unsafe } as unknown as Sql;

    const service = new RagSearchService(sql, makeEmbedding());
    const [results] = await service.search('acme', 'order 4711');

    expect(results).toHaveLength(1);
    expect(results[0].content).toBe('vector hit');
    const ranParadeDbSql = unsafe.mock.calls.some((call) => isFts(call[0]));
    expect(ranParadeDbSql).toBe(false);
  });

  it('falls back to vector-only and remembers the capability when the BM25 leg hits 3F000', async () => {
    const unsafe = vi.fn(async (text: string) => {
      if (isFts(text)) {
        throw pgError('3F000', 'schema "paradedb" does not exist');
      }
      return isVector(text) ? [row('v1', 'vector hit', 0.9)] : [];
    });
    const sql = { unsafe } as unknown as Sql;

    const service = new RagSearchService(sql, makeEmbedding());
    const [results] = await service.search('acme', 'order 4711');

    expect(results).toHaveLength(1);
    expect(results[0].content).toBe('vector hit');
    expect(hoisted.markBm25Unavailable).toHaveBeenCalledWith(sql);
  });

  it('falls back the same way on 42883 (undefined function/operator)', async () => {
    const unsafe = vi.fn(async (text: string) => {
      if (isFts(text)) {
        throw pgError('42883', 'operator does not exist: uuid @@@ text');
      }
      return isVector(text) ? [row('v1', 'vector hit', 0.9)] : [];
    });
    const sql = { unsafe } as unknown as Sql;

    const service = new RagSearchService(sql, makeEmbedding());
    const [results] = await service.search('acme', 'order 4711');

    expect(results).toHaveLength(1);
    expect(hoisted.markBm25Unavailable).toHaveBeenCalledWith(sql);
  });

  it('still runs the hybrid BM25 + vector path on a ParadeDB database', async () => {
    const unsafe = vi.fn(async (text: string) => {
      if (isFts(text)) {
        return [row('f1', 'bm25 hit', 3.2)];
      }
      return isVector(text) ? [row('v1', 'vector hit', 0.9)] : [];
    });
    const sql = { unsafe } as unknown as Sql;

    const service = new RagSearchService(sql, makeEmbedding());
    const [results] = await service.search('acme', 'order 4711');

    const contents = results.map((r) => r.content).sort();
    expect(contents).toEqual(['bm25 hit', 'vector hit']);
    expect(hoisted.markBm25Unavailable).not.toHaveBeenCalled();
  });
});
