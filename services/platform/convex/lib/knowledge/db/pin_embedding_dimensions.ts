'use node';

/**
 * Pin a `chunks.embedding` column to explicit dimensions and create the HNSW
 * index. Runtime convergence step (not a migration): the target dimension
 * depends on the configured embedding model, which can vary per deployment.
 *
 * Generalized from `services/rag/app/services/database.ts::pinEmbeddingDimensions`
 * to accept the schema so both `private_knowledge` (RAG) and `public_web`
 * (crawler) corpora can pin their own chunks tables. The `private_knowledge`
 * variant additionally pins `semantic_cache.query_embedding`.
 */

import type { Sql } from 'postgres';

import { logger } from '../logger';
import {
  isProgramLimitExceeded,
  isUndefinedTable,
  PRIVATE_KNOWLEDGE_SCHEMA,
} from './knowledge_db';
import { withRetry } from './retry';

const HNSW_PGVECTOR_DIM_LIMIT = 2000;

export async function pinEmbeddingDimensions(
  sql: Sql,
  schema: string,
  dimensions: number,
): Promise<void> {
  await withRetry(async () => {
    let colType: string | null;
    try {
      const rows = await sql.unsafe<{ format_type: string }[]>(
        `SELECT format_type(atttypid, atttypmod) AS format_type
         FROM pg_attribute
         WHERE attrelid = $1::regclass AND attname = 'embedding'`,
        [`${schema}.chunks`],
      );
      colType = rows[0]?.format_type ?? null;
    } catch (err) {
      if (isUndefinedTable(err)) {
        logger.warn(
          `${schema}.chunks table does not exist yet, skipping dimension check`,
        );
        return;
      }
      throw err;
    }

    const expectedType = `vector(${dimensions})`;

    if (colType === 'vector') {
      logger.info(
        `Pinning ${schema}.chunks.embedding to vector(${dimensions})`,
      );
      await sql.unsafe(
        `ALTER TABLE ${schema}.chunks ALTER COLUMN embedding TYPE vector(${dimensions})`,
      );
    } else if (colType !== expectedType) {
      logger.warn(
        `Embedding column is ${colType}, expected ${expectedType}. Dimension ` +
          `mismatch — existing embeddings may need re-generation.`,
      );
      await sql.unsafe(
        `ALTER TABLE ${schema}.chunks ALTER COLUMN embedding TYPE vector(${dimensions})`,
      );
    } else {
      logger.info(`Embedding column already pinned to ${expectedType}`);
    }

    try {
      await sql.unsafe(`SELECT ${schema}.create_chunks_hnsw_index()`);
      logger.info('HNSW index ensured');
    } catch (err) {
      if (dimensions > HNSW_PGVECTOR_DIM_LIMIT || isProgramLimitExceeded(err)) {
        logger.warn(
          `Cannot create HNSW index: ${dimensions} dimensions exceeds pgvector ` +
            `limit (2000). Vector search will use sequential scan.`,
        );
      } else {
        throw err;
      }
    }

    // The RAG corpus additionally caches query embeddings; pin that column too.
    if (schema === PRIVATE_KNOWLEDGE_SCHEMA) {
      let cacheColType: string | null = null;
      try {
        const rows = await sql.unsafe<{ format_type: string }[]>(
          `SELECT format_type(atttypid, atttypmod) AS format_type
           FROM pg_attribute
           WHERE attrelid = $1::regclass AND attname = 'query_embedding'`,
          [`${schema}.semantic_cache`],
        );
        cacheColType = rows[0]?.format_type ?? null;
      } catch (err) {
        if (!isUndefinedTable(err)) {
          throw err;
        }
        cacheColType = null;
      }
      if (cacheColType !== null && cacheColType !== expectedType) {
        logger.info(
          `Pinning ${schema}.semantic_cache.query_embedding to vector(${dimensions}); ` +
            `truncating stale rows`,
        );
        await sql.unsafe(`TRUNCATE TABLE ${schema}.semantic_cache`);
        await sql.unsafe(
          `ALTER TABLE ${schema}.semantic_cache ALTER COLUMN query_embedding TYPE vector(${dimensions})`,
        );
      }
    }
  });
}
