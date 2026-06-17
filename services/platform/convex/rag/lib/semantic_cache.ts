'use node';

/**
 * Semantic cache for RAG search results.
 *
 * Per-tenant cosine-similarity lookup keyed on `org_slug`. Stores results with
 * TTL and supports invalidation by file IDs. All queries ALWAYS filter by
 * `org_slug` so two orgs with identical queries get independent entries.
 */

import type { Sql } from 'postgres';
import { z } from 'zod';

import {
  isUndefinedColumn,
  isUndefinedTable,
  PRIVATE_KNOWLEDGE_SCHEMA as SCHEMA,
} from '../../lib/knowledge/db/knowledge_db';
import { withRetry } from '../../lib/knowledge/db/retry';
import { logger } from '../../lib/knowledge/logger';

const metadataRecordSchema = z.record(z.string(), z.unknown());

export interface CacheEntry {
  queryText: string;
  responseText: string;
  metadata: Record<string, unknown>;
  hitCount: number;
  createdAt: Date | null;
}

export interface SemanticCacheStoreOptions {
  metadata?: Record<string, unknown> | null;
  ttlHours?: number;
  fileIds?: string[] | null;
}

function isTableNotReady(err: unknown): boolean {
  return isUndefinedTable(err) || isUndefinedColumn(err);
}

export class SemanticCache {
  private readonly sql: Sql;

  constructor(sql: Sql) {
    this.sql = sql;
  }

  /** Find a cached result by cosine similarity within `org_slug`. */
  async lookup(
    orgSlug: string,
    queryEmbedding: number[],
    threshold = 0.95,
  ): Promise<CacheEntry | null> {
    const vecStr = JSON.stringify(queryEmbedding);
    const now = new Date();

    try {
      return await withRetry(async () => {
        const rows = await this.sql.unsafe<
          {
            query_text: string;
            response_text: string;
            metadata: unknown;
            hit_count: number;
            created_at: Date;
          }[]
        >(
          `SELECT query_text, response_text, metadata, hit_count, created_at,
                  1 - (query_embedding <=> $1::vector) AS similarity
           FROM ${SCHEMA}.semantic_cache
           WHERE org_slug = $2
             AND expires_at > $3
             AND 1 - (query_embedding <=> $1::vector) >= $4
           ORDER BY query_embedding <=> $1::vector
           LIMIT 1`,
          [vecStr, orgSlug, now, threshold],
        );

        const row = rows[0];
        if (!row) {
          return null;
        }

        await this.sql.unsafe(
          `UPDATE ${SCHEMA}.semantic_cache
           SET hit_count = hit_count + 1
           WHERE org_slug = $1 AND query_text = $2 AND expires_at > $3`,
          [orgSlug, row.query_text, now],
        );

        let metadata: Record<string, unknown> = {};
        if (row.metadata) {
          const candidate =
            typeof row.metadata === 'string'
              ? JSON.parse(row.metadata)
              : row.metadata;
          const validated = metadataRecordSchema.safeParse(candidate);
          metadata = validated.success ? validated.data : {};
        }

        return {
          queryText: row.query_text,
          responseText: row.response_text,
          metadata,
          hitCount: row.hit_count + 1,
          createdAt: row.created_at,
        };
      });
    } catch (err) {
      if (isTableNotReady(err)) {
        logger.debug('Semantic cache table not ready, skipping lookup');
        return null;
      }
      logger.warn(
        `Semantic cache lookup failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /** Store a query-response pair in the cache, scoped to `org_slug`. */
  async store(
    orgSlug: string,
    query: string,
    embedding: number[],
    response: string,
    options: SemanticCacheStoreOptions = {},
  ): Promise<void> {
    const vecStr = JSON.stringify(embedding);
    const now = new Date();
    const ttlHours = options.ttlHours ?? 24;
    const expiresAt = new Date(now.getTime() + ttlHours * 3600 * 1000);
    const metaJson = options.metadata ? JSON.stringify(options.metadata) : '{}';
    const fileIds = options.fileIds ?? [];

    try {
      await withRetry(async () => {
        await this.sql.unsafe(
          `INSERT INTO ${SCHEMA}.semantic_cache
              (org_slug, query_text, query_embedding, response_text,
               metadata, expires_at, file_ids)
           VALUES ($1, $2, $3::vector, $4, $5::jsonb, $6, $7)`,
          [orgSlug, query, vecStr, response, metaJson, expiresAt, fileIds],
        );
      });
    } catch (err) {
      if (isTableNotReady(err)) {
        logger.debug('Semantic cache table not ready, skipping store');
        return;
      }
      logger.warn(
        `Semantic cache store failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Remove this org's cache entries referencing any of the given file IDs. */
  async invalidate(orgSlug: string, fileIds: string[]): Promise<number> {
    if (fileIds.length === 0) {
      return 0;
    }
    try {
      return await withRetry(async () => {
        const result = await this.sql.unsafe(
          `DELETE FROM ${SCHEMA}.semantic_cache
           WHERE org_slug = $1 AND file_ids && $2`,
          [orgSlug, fileIds],
        );
        const count = result.count ?? 0;
        if (count > 0) {
          logger.info(
            `Invalidated ${count} semantic cache entries for org=${orgSlug} file_ids=${fileIds.join(',')}`,
          );
        }
        return count;
      });
    } catch (err) {
      if (isTableNotReady(err)) {
        return 0;
      }
      logger.warn(
        `Semantic cache invalidation failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 0;
    }
  }

  /** Remove expired cache entries (org-scoped when a slug is provided). */
  async cleanup(orgSlug: string | null = null): Promise<number> {
    const now = new Date();
    try {
      return await withRetry(async () => {
        const result =
          orgSlug === null
            ? await this.sql.unsafe(
                `DELETE FROM ${SCHEMA}.semantic_cache WHERE expires_at <= $1`,
                [now],
              )
            : await this.sql.unsafe(
                `DELETE FROM ${SCHEMA}.semantic_cache
                 WHERE org_slug = $1 AND expires_at <= $2`,
                [orgSlug, now],
              );
        const count = result.count ?? 0;
        if (count > 0) {
          logger.info(
            `Cleaned up ${count} expired semantic cache entries (org=${orgSlug ?? '<all>'})`,
          );
        }
        return count;
      });
    } catch (err) {
      if (isTableNotReady(err)) {
        return 0;
      }
      logger.warn(
        `Semantic cache cleanup failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 0;
    }
  }
}
