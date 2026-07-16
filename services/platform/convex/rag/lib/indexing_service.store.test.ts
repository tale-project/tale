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
 * Regression guard for large-file indexing: `storePreparedDocument` must embed
 * chunks in bounded batches as it inserts, never all at once. Embedding every
 * chunk of a large document (tens of thousands) up-front materialized ~600 MB+
 * of vectors and OOM-killed the Convex action (a 96 MB text file failed with an
 * opaque `InternalServerError`). This test feeds far more chunks than one batch
 * and asserts no single `embedTexts` call ever receives the whole document.
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

/** Minimal fake `postgres` tagged-template client covering the store path. */
function makeFakeSql(insertedChunks: { count: number }): Sql {
  const tx = {
    unsafe: vi.fn(async (query: string) => {
      if (query.includes('INTO private_knowledge.documents')) {
        return [{ id: 'doc-uuid-1', is_insert: true }];
      }
      if (query.includes('INTO private_knowledge.chunks')) {
        insertedChunks.count += 1;
      }
      return [];
    }),
  };
  const sql = {
    begin: (cb: (tx: unknown) => Promise<unknown>) => cb(tx),
  };
  return sql as unknown as Sql;
}

describe('storePreparedDocument — bounded-memory batched embedding', () => {
  it('embeds in batches of at most MAX_BATCH_SIZE, never the whole document', async () => {
    const chunkCount = MAX_BATCH_SIZE * 3 + 7; // spans four batches
    const prepared: PreparedDocument = {
      contentHash: 'hash',
      chunks: Array.from({ length: chunkCount }, (_, i) => makeChunk(i)),
      visionUsed: false,
      sourceCreatedAt: null,
      sourceModifiedAt: null,
    };

    const batchSizes: number[] = [];
    const embeddingService = {
      dimensions: 4,
      embedTexts: vi.fn(async (texts: string[]) => {
        batchSizes.push(texts.length);
        return texts.map(() => [0, 0, 0, 0]);
      }),
    } as unknown as EmbeddingService;

    const insertedChunks = { count: 0 };
    const result = await storePreparedDocument(
      makeFakeSql(insertedChunks),
      'org-slug',
      'file-1',
      'big.txt',
      prepared,
      embeddingService,
    );

    // Every chunk stored, one INSERT each.
    expect(result.chunks_created).toBe(chunkCount);
    expect(insertedChunks.count).toBe(chunkCount);

    // Bounded memory: no single embed call ever saw more than one batch, and
    // the document required more than one call (i.e. it really batched).
    expect(batchSizes.length).toBeGreaterThan(1);
    expect(Math.max(...batchSizes)).toBeLessThanOrEqual(MAX_BATCH_SIZE);
    expect(batchSizes.reduce((a, b) => a + b, 0)).toBe(chunkCount);
  });
});
