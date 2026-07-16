import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import type { ContentChunk } from '../../lib/knowledge/chunking/splitter';
import { MAX_BATCH_SIZE } from '../../lib/knowledge/embedding/service';
import type { EmbeddingService } from '../../lib/knowledge/embedding/service';
import {
  type PreparedDocument,
  storePreparedDocument,
} from './indexing_service';

/**
 * Regression guards for large-file indexing:
 *
 * 1. #2744 — `storePreparedDocument` must embed chunks in bounded batches as it
 *    inserts, never all at once (embedding a whole large document up-front
 *    OOM-killed the action).
 * 2. #2752 — every batch commits in its OWN transaction and the committed chunk
 *    prefix is the resume checkpoint: a `deadline` yields a `partial` result
 *    mid-document, and a follow-up run resumes AFTER the committed prefix
 *    (skipping their embeddings) instead of restarting from zero. The old
 *    single big transaction rolled everything back when the action hit its
 *    wall-clock cap, making near-cap documents permanently unindexable.
 */

function makeChunk(index: number): ContentChunk {
  return {
    content: `chunk ${index} content`,
    index,
    coreContent: `chunk ${index}`,
    prefixOverlap: '',
    suffixOverlap: '',
  };
}

function makePrepared(chunkCount: number, hash = 'hash-a'): PreparedDocument {
  return {
    contentHash: hash,
    chunks: Array.from({ length: chunkCount }, (_, i) => makeChunk(i)),
    visionUsed: false,
    sourceCreatedAt: null,
    sourceModifiedAt: null,
  };
}

interface FakeDocRow {
  id: string;
  content_hash: string;
  status: string;
}

/**
 * In-memory fake of the `documents` + `chunks` tables covering exactly the SQL
 * the store path issues. Each `sql.begin` transaction commits immediately (the
 * store path's whole point is that batches are independently durable).
 */
function makeFakeDb(): {
  sql: Sql;
  state: { doc: FakeDocRow | null; chunkIndexes: number[] };
} {
  const state: { doc: FakeDocRow | null; chunkIndexes: number[] } = {
    doc: null,
    chunkIndexes: [],
  };

  const run = async (
    query: string,
    params: unknown[] = [],
  ): Promise<unknown[]> => {
    if (query.includes('SELECT id, content_hash, status FROM')) {
      return state.doc ? [state.doc] : [];
    }
    if (query.includes('INSERT INTO private_knowledge.documents')) {
      state.doc = {
        id: 'doc-uuid-1',
        content_hash: String(params[3]),
        status: 'processing',
      };
      return [{ id: state.doc.id }];
    }
    if (query.includes('SELECT COALESCE(MAX(chunk_index)')) {
      return [{ next_index: state.chunkIndexes.length }];
    }
    if (query.includes('SELECT content_hash FROM')) {
      return state.doc ? [{ content_hash: state.doc.content_hash }] : [];
    }
    if (query.includes('DELETE FROM private_knowledge.chunks')) {
      state.chunkIndexes = [];
      return [];
    }
    if (query.includes('INSERT INTO private_knowledge.chunks')) {
      // 9 params per row; chunk_index is the 3rd of each group.
      for (let base = 0; base < params.length; base += 9) {
        state.chunkIndexes.push(Number(params[base + 2]));
      }
      return [];
    }
    if (query.includes('UPDATE private_knowledge.documents')) {
      if (state.doc) {
        if (query.includes("status = 'completed'")) {
          state.doc.status = 'completed';
        } else if (query.includes("status = 'processing'")) {
          state.doc.status = 'processing';
          state.doc.content_hash = String(params[3]);
        }
      }
      return [];
    }
    return [];
  };

  const tx = { unsafe: vi.fn(run) };
  const sql = {
    begin: (cb: (t: unknown) => Promise<unknown>) => cb(tx),
    unsafe: vi.fn(run),
  };
  return { sql: sql as unknown as Sql, state };
}

function makeEmbedding(batchSizes: number[]): EmbeddingService {
  return {
    dimensions: 4,
    embedTexts: vi.fn(async (texts: string[]) => {
      batchSizes.push(texts.length);
      return texts.map(() => [0, 0, 0, 0]);
    }),
  } as unknown as EmbeddingService;
}

describe('storePreparedDocument — bounded batches, per-batch commits, resume', () => {
  it('embeds in batches of at most MAX_BATCH_SIZE, never the whole document', async () => {
    const chunkCount = MAX_BATCH_SIZE * 3 + 7; // spans four batches
    const { sql, state } = makeFakeDb();
    const batchSizes: number[] = [];

    const result = await storePreparedDocument(
      sql,
      'org-slug',
      'file-1',
      'big.txt',
      makePrepared(chunkCount),
      makeEmbedding(batchSizes),
    );

    expect(result.success).toBe(true);
    expect(result.chunks_created).toBe(chunkCount);
    expect(state.chunkIndexes).toHaveLength(chunkCount);
    expect(new Set(state.chunkIndexes).size).toBe(chunkCount);
    expect(state.doc?.status).toBe('completed');
    // Bounded memory: no single embed call ever saw more than one batch, and
    // the document required more than one call (i.e. it really batched).
    expect(batchSizes.length).toBeGreaterThan(1);
    expect(Math.max(...batchSizes)).toBeLessThanOrEqual(MAX_BATCH_SIZE);
    expect(batchSizes.reduce((a, b) => a + b, 0)).toBe(chunkCount);
  });

  it('yields a partial result at the deadline with the committed prefix intact', async () => {
    const chunkCount = MAX_BATCH_SIZE * 3;
    const { sql, state } = makeFakeDb();

    const result = await storePreparedDocument(
      sql,
      'org-slug',
      'file-1',
      'big.txt',
      makePrepared(chunkCount),
      makeEmbedding([]),
      // Already past: the loop still commits ONE batch (forward-progress
      // guarantee), then yields.
      { deadline: Date.now() - 1 },
    );

    expect(result.partial).toBe(true);
    expect(result.chunks_total).toBe(chunkCount);
    expect(result.chunks_created).toBe(MAX_BATCH_SIZE);
    // The committed prefix survives — nothing was rolled back.
    expect(state.chunkIndexes).toHaveLength(MAX_BATCH_SIZE);
    expect(state.doc?.status).toBe('processing');
  });

  it('resumes after the committed prefix without re-embedding it', async () => {
    const chunkCount = MAX_BATCH_SIZE * 3;
    const { sql, state } = makeFakeDb();

    const first = await storePreparedDocument(
      sql,
      'org-slug',
      'file-1',
      'big.txt',
      makePrepared(chunkCount),
      makeEmbedding([]),
      { deadline: Date.now() - 1 },
    );
    expect(first.partial).toBe(true);

    const resumeBatchSizes: number[] = [];
    const resumed = await storePreparedDocument(
      sql,
      'org-slug',
      'file-1',
      'big.txt',
      makePrepared(chunkCount),
      makeEmbedding(resumeBatchSizes),
    );

    expect(resumed.partial ?? false).toBe(false);
    expect(resumed.success).toBe(true);
    expect(state.doc?.status).toBe('completed');
    // All chunks present exactly once — the resume never duplicated the prefix.
    expect(state.chunkIndexes).toHaveLength(chunkCount);
    expect(new Set(state.chunkIndexes).size).toBe(chunkCount);
    // Only the two remaining batches were embedded, not the stored prefix.
    const resumedChunks = resumeBatchSizes.reduce((a, b) => a + b, 0);
    expect(resumedChunks).toBe(chunkCount - MAX_BATCH_SIZE);
  });

  it('skips a completed document with unchanged content without embedding', async () => {
    const chunkCount = MAX_BATCH_SIZE + 3;
    const { sql, state } = makeFakeDb();

    await storePreparedDocument(
      sql,
      'org-slug',
      'file-1',
      'big.txt',
      makePrepared(chunkCount),
      makeEmbedding([]),
    );
    expect(state.doc?.status).toBe('completed');

    const rerunBatches: number[] = [];
    const rerun = await storePreparedDocument(
      sql,
      'org-slug',
      'file-1',
      'big.txt',
      makePrepared(chunkCount),
      makeEmbedding(rerunBatches),
    );

    expect(rerun.skipped).toBe(true);
    expect(rerun.skip_reason).toBe('content_unchanged');
    expect(rerunBatches).toHaveLength(0);
    expect(state.chunkIndexes).toHaveLength(chunkCount);
  });

  it('wipes the old chunks and rewrites from zero when the content hash changes', async () => {
    const { sql, state } = makeFakeDb();

    await storePreparedDocument(
      sql,
      'org-slug',
      'file-1',
      'big.txt',
      makePrepared(MAX_BATCH_SIZE, 'hash-a'),
      makeEmbedding([]),
    );
    expect(state.chunkIndexes).toHaveLength(MAX_BATCH_SIZE);

    const newCount = MAX_BATCH_SIZE + 5;
    const rewritten = await storePreparedDocument(
      sql,
      'org-slug',
      'file-1',
      'big.txt',
      makePrepared(newCount, 'hash-b'),
      makeEmbedding([]),
    );

    expect(rewritten.success).toBe(true);
    expect(rewritten.skipped).toBe(false);
    expect(state.chunkIndexes).toHaveLength(newCount);
    expect(new Set(state.chunkIndexes).size).toBe(newCount);
    expect(state.doc?.content_hash).toBe('hash-b');
    expect(state.doc?.status).toBe('completed');
  });
});
