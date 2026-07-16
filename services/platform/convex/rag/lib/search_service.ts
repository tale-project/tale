'use node';

/**
 * Hybrid search service for the RAG pipeline.
 *
 * BM25 full-text (pg_search) + pgvector similarity with RRF fusion. Per-tenant
 * scoping by `org_slug` is ALWAYS applied; optional further restriction by
 * `file_ids`, a hierarchical `folder_path` prefix, and flat document-metadata
 * filters. Optional semantic caching and cross-encoder re-ranking.
 */

import type { Sql } from 'postgres';
import { z } from 'zod';

import { withRetry } from '../../lib/knowledge/db/retry';
import type {
  EmbeddingService,
  EmbeddingUsage,
} from '../../lib/knowledge/embedding/service';
import { Reranker } from '../../lib/knowledge/retrieval/reranker';
import { mergeRrf } from '../../lib/knowledge/retrieval/rrf';

/** Values acceptable as positional parameters to postgres.js `sql.unsafe`. */
type SqlParam = string | number | boolean | null | Date | string[] | number[];

import {
  bm25Available,
  isDataCorrupted,
  isInternalError,
  isUndefinedColumn,
  isUndefinedFunction,
  isUndefinedSchema,
  isUndefinedTable,
  markBm25Unavailable,
  PRIVATE_KNOWLEDGE_SCHEMA as SCHEMA,
} from '../../lib/knowledge/db/knowledge_db';
import { logger } from '../../lib/knowledge/logger';
import { settings } from './config';
import { SemanticCache } from './semantic_cache';

export type MetadataFilterValue =
  | string
  | number
  | boolean
  | (string | number | boolean)[];

export interface SearchResultRow {
  content: string;
  score: number;
  file_id: string | null;
  filename: string | null;
  source_created_at: Date | null;
  source_modified_at: Date | null;
  cached?: boolean;
}

export interface SearchOptions {
  fileIds?: string[] | null;
  folderPath?: string | null;
  metadataFilters?: Record<string, MetadataFilterValue> | null;
  topK?: number;
  similarityThreshold?: number;
}

let sharedReranker: Reranker | null = null;

function getSharedReranker(): Reranker {
  if (sharedReranker === null) {
    sharedReranker = new Reranker({
      modelName: settings.reranking_model,
      provider: settings.reranking_provider === 'api' ? 'api' : 'local',
      apiBaseUrl: settings.reranking_api_base_url,
      apiKey: settings.reranking_api_key,
    });
  }
  return sharedReranker;
}

/** Render a scalar the way Postgres `jsonb ->> key` renders it. */
function jsonbScalarText(value: string | number | boolean): string {
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value);
}

function emptyUsage(model: string): EmbeddingUsage {
  return { promptTokens: 0, totalTokens: 0, model };
}

// A type alias (not an interface) so it satisfies `mergeRrf`'s
// `Record<string, unknown>` constraint without an index signature poisoning
// property-access types.
type ChunkRow = {
  id: string;
  chunk_content: string | null;
  core_content: string | null;
  chunk_index: number;
  document_id: string;
  file_id: string | null;
  filename: string | null;
  source_created_at: Date | null;
  source_modified_at: Date | null;
  created_at: Date | null;
  score: number;
};

type MergedRow = ChunkRow & {
  rrf_score: number;
  reranking_score?: number;
};

// Rerank input drops the explicit nullable text fields and re-adds them as
// `string | undefined` so a MergedRow satisfies the reranker's
// `RerankableResult` contract. The reranker preserves all other fields.
type RerankRow = Omit<MergedRow, 'core_content' | 'chunk_content'> & {
  core_content?: string;
  chunk_content?: string;
  content: string;
};

const backgroundTasks = new Set<Promise<void>>();

export class RagSearchService {
  private readonly sql: Sql;
  private readonly embedding: EmbeddingService;
  private readonly semanticCache: SemanticCache | null;
  private readonly reranker: Reranker | null;

  constructor(sql: Sql, embedding: EmbeddingService) {
    this.sql = sql;
    this.embedding = embedding;
    this.semanticCache = settings.semantic_cache_enabled
      ? new SemanticCache(sql)
      : null;
    this.reranker = settings.reranking_enabled ? getSharedReranker() : null;
  }

  /** Build the WHERE clause for per-tenant + optional per-document scoping. */
  private buildScopeClause(
    orgSlug: string,
    fileIds: string[] | null | undefined,
    paramOffset: number,
    folderPath: string | null | undefined,
    metadataFilters: Record<string, MetadataFilterValue> | null | undefined,
  ): { clause: string; params: SqlParam[] } {
    const orgParam = paramOffset + 1;
    let clause = ` AND c.org_slug = $${orgParam}`;
    const params: SqlParam[] = [orgSlug];

    const docConditions: string[] = [];
    if (fileIds && fileIds.length > 0) {
      params.push(fileIds);
      docConditions.push(`file_id = ANY($${paramOffset + params.length})`);
    }
    if (folderPath) {
      params.push(folderPath);
      const folderParam = `$${paramOffset + params.length}`;
      docConditions.push(
        `(folder_path = ${folderParam} ` +
          `OR left(folder_path, char_length(${folderParam}) + 1) = ${folderParam} || '/')`,
      );
    }
    if (metadataFilters) {
      const equality: Record<string, string | number | boolean> = {};
      for (const [key, value] of Object.entries(metadataFilters)) {
        if (!Array.isArray(value)) {
          equality[key] = value;
        }
      }
      if (Object.keys(equality).length > 0) {
        params.push(JSON.stringify(equality));
        docConditions.push(
          `metadata @> $${paramOffset + params.length}::jsonb`,
        );
      }
      for (const [key, values] of Object.entries(metadataFilters)) {
        if (!Array.isArray(values)) {
          continue;
        }
        params.push(key);
        const keyParam = paramOffset + params.length;
        params.push(values.map((v) => jsonbScalarText(v)));
        docConditions.push(
          `metadata->>$${keyParam} = ANY($${paramOffset + params.length})`,
        );
      }
    }

    if (docConditions.length > 0) {
      clause +=
        ` AND c.document_id IN (` +
        `SELECT id FROM ${SCHEMA}.documents ` +
        `WHERE org_slug = $${orgParam} AND ${docConditions.join(' AND ')})`;
    }

    return { clause, params };
  }

  private async ftsSearch(
    query: string,
    orgSlug: string,
    fileIds: string[] | null | undefined,
    limit: number,
    folderPath: string | null | undefined,
    metadataFilters: Record<string, MetadataFilterValue> | null | undefined,
  ): Promise<ChunkRow[]> {
    // A database without pg_search (any managed Postgres) cannot run the
    // `paradedb.*` SQL below — skip the BM25 leg entirely so the search
    // degrades to vector-only instead of throwing (#2755).
    if (!(await bm25Available(this.sql))) {
      return [];
    }
    const { clause, params } = this.buildScopeClause(
      orgSlug,
      fileIds,
      1,
      folderPath,
      metadataFilters,
    );
    const sqlText = `
      SELECT c.id, c.chunk_content, c.core_content, c.chunk_index, c.document_id,
             d.file_id, d.filename,
             d.source_created_at, d.source_modified_at, d.created_at,
             paradedb.score(c.id) AS score
      FROM ${SCHEMA}.chunks c
      LEFT JOIN ${SCHEMA}.documents d ON c.document_id = d.id
      WHERE c.id @@@ paradedb.match('chunk_content', $1)
      ${clause}
      ORDER BY score DESC
      LIMIT $${2 + params.length}
    `;
    const allParams = [query, ...params, limit];
    try {
      return await withRetry(() =>
        this.sql.unsafe<ChunkRow[]>(sqlText, allParams),
      );
    } catch (err) {
      if (isDataCorrupted(err)) {
        logger.warn(`BM25 index corrupted: ${errMsg(err)}`);
        return [];
      }
      if (isInternalError(err)) {
        logger.warn(`FTS search failed: ${errMsg(err)}`);
        return [];
      }
      if (isUndefinedSchema(err) || isUndefinedFunction(err)) {
        // pg_search vanished (or the capability probe raced a DROP): remember
        // the answer so later searches skip the leg without erroring again.
        markBm25Unavailable(this.sql);
        logger.warn(
          `BM25 unavailable on this database, falling back to vector-only: ${errMsg(err)}`,
        );
        return [];
      }
      throw err;
    }
  }

  private async vectorSearch(
    embedding: number[],
    orgSlug: string,
    fileIds: string[] | null | undefined,
    limit: number,
    folderPath: string | null | undefined,
    metadataFilters: Record<string, MetadataFilterValue> | null | undefined,
  ): Promise<ChunkRow[]> {
    const vecStr = JSON.stringify(embedding);
    const { clause, params } = this.buildScopeClause(
      orgSlug,
      fileIds,
      1,
      folderPath,
      metadataFilters,
    );
    const sqlText = `
      SELECT c.id, c.chunk_content, c.core_content, c.chunk_index, c.document_id,
             d.file_id, d.filename,
             d.source_created_at, d.source_modified_at, d.created_at,
             1 - (c.embedding <=> $1::vector) AS score
      FROM ${SCHEMA}.chunks c
      LEFT JOIN ${SCHEMA}.documents d ON c.document_id = d.id
      WHERE c.embedding IS NOT NULL
      ${clause}
      ORDER BY c.embedding <=> $1::vector
      LIMIT $${2 + params.length}
    `;
    const allParams = [vecStr, ...params, limit];
    return withRetry(() => this.sql.unsafe<ChunkRow[]>(sqlText, allParams));
  }

  private async rebuildBm25Index(): Promise<void> {
    try {
      logger.warn('Rebuilding BM25 index due to corruption');
      await withRetry(() =>
        this.sql.unsafe(`REINDEX INDEX ${SCHEMA}.idx_pk_chunks_bm25`),
      );
      logger.info('BM25 index rebuilt successfully');
    } catch (err) {
      logger.error(`BM25 index rebuild failed: ${errMsg(err)}`);
    }
  }

  /** Hybrid BM25 + vector search scoped to `org_slug`. */
  async search(
    orgSlug: string,
    query: string,
    options: SearchOptions = {},
  ): Promise<[SearchResultRow[], EmbeddingUsage]> {
    const fileIds = options.fileIds ?? null;
    const folderPath = options.folderPath ?? null;
    const metadataFilters = options.metadataFilters ?? null;
    const topK = options.topK ?? 10;
    const similarityThreshold = options.similarityThreshold ?? 0.0;

    let queryEmbedding: number[] | null = null;
    let usage: EmbeddingUsage = emptyUsage('');

    try {
      const [queryResult, ftsResults] = await Promise.all([
        this.embedding.embedQueryWithUsage(query),
        this.ftsSearch(
          query,
          orgSlug,
          fileIds,
          topK * 3,
          folderPath,
          metadataFilters,
        ),
      ]);
      queryEmbedding = queryResult.embedding;
      usage = queryResult.usage;

      // Semantic cache lookup (org-scoped; bypassed for filtered queries).
      if (
        this.semanticCache &&
        queryEmbedding &&
        !folderPath &&
        !metadataFilters
      ) {
        const cached = await this.semanticCache.lookup(
          orgSlug,
          queryEmbedding,
          settings.semantic_cache_similarity_threshold,
        );
        if (cached) {
          logger.debug(`Semantic cache hit for query: ${query.slice(0, 80)}`);
          const parsedCache = parseCachedResults(cached.responseText);
          if (parsedCache !== null) {
            for (const r of parsedCache) {
              r.cached = true;
            }
            return [parsedCache, usage];
          }
          logger.warn(
            'Invalid cached response format, performing fresh search',
          );
        }
      }

      let vectorResults = await this.vectorSearch(
        queryEmbedding,
        orgSlug,
        fileIds,
        topK * 3,
        folderPath,
        metadataFilters,
      );

      // Pre-filter vector results by cosine similarity.
      if (similarityThreshold > 0) {
        const preCount = vectorResults.length;
        vectorResults = vectorResults.filter(
          (r) => r.score >= similarityThreshold,
        );
        if (preCount > 0 && vectorResults.length === 0) {
          return [[], usage];
        }
      }

      if (ftsResults.length === 0 && vectorResults.length === 0) {
        return [[], usage];
      }

      const rrfPoolSize = this.reranker
        ? Math.max(topK, settings.reranking_candidates)
        : topK;
      const merged: MergedRow[] = mergeRrf<ChunkRow>(
        [ftsResults, vectorResults],
        rrfPoolSize,
      );

      if (settings.recency_boost_enabled) {
        applyRecencyBoost(
          merged,
          settings.recency_decay_base,
          settings.recency_max_age_days,
        );
      }

      // Ranked rows carry a `content` field + an optional `reranking_score`;
      // the reranker, when enabled, reorders + scores them. Built with a
      // for-loop + `Object.assign` (no `map` + spread, which the no-map-spread
      // rule flags) — the assign writes into a fresh target so each
      // `MergedRow` is left untouched.
      let rankedRows: RerankRow[] = [];
      for (const item of merged) {
        const row: RerankRow = Object.assign({}, item, {
          core_content: item.core_content ?? undefined,
          chunk_content: item.chunk_content ?? undefined,
          content: item.core_content || item.chunk_content || '',
        });
        rankedRows.push(row);
      }

      if (this.reranker && rankedRows.length > 0) {
        try {
          rankedRows = await this.reranker.rerank<RerankRow>(
            query,
            rankedRows,
            Math.min(topK, settings.reranking_top_k),
          );
        } catch (rerankErr) {
          logger.warn(
            `Re-ranking failed, falling back to RRF order: ${errMsg(rerankErr)}`,
          );
          rankedRows = rankedRows.slice(0, topK);
        }
      } else {
        rankedRows = rankedRows.slice(0, topK);
      }

      const results: SearchResultRow[] = rankedRows.map((item) => ({
        content: item.core_content || item.chunk_content || '',
        score: item.reranking_score ?? item.rrf_score,
        file_id: item.file_id ? item.file_id : null,
        filename: item.filename ?? null,
        source_created_at: item.source_created_at ?? null,
        source_modified_at: item.source_modified_at ?? null,
      }));

      // Semantic cache store (org-scoped; never for filtered results).
      if (
        this.semanticCache &&
        queryEmbedding &&
        results.length > 0 &&
        !folderPath &&
        !metadataFilters
      ) {
        const resultFileIds = results
          .map((r) => r.file_id)
          .filter((id): id is string => Boolean(id));
        await this.semanticCache.store(
          orgSlug,
          query,
          queryEmbedding,
          JSON.stringify(results),
          {
            ttlHours: settings.semantic_cache_ttl_hours,
            fileIds: resultFileIds,
          },
        );
      }

      return [results, usage];
    } catch (err) {
      if (isUndefinedTable(err)) {
        logger.info('Tables not yet created, returning empty results');
        return [[], usage];
      }
      if (isUndefinedColumn(err)) {
        logger.info('Schema not ready, returning empty results');
        return [[], usage];
      }

      const isBm25 =
        err instanceof Error && err.message.toLowerCase().includes('bm25');
      const isCorruption = isDataCorrupted(err);
      if ((isInternalError(err) || isCorruption) && (isBm25 || isCorruption)) {
        logger.warn(
          `BM25 index issue (corruption=${isCorruption}): ${errMsg(err)}, falling back to vector-only`,
        );
        if (isCorruption) {
          const task = this.rebuildBm25Index();
          backgroundTasks.add(task);
          void task.finally(() => backgroundTasks.delete(task));
        }
        if (queryEmbedding === null) {
          queryEmbedding = await this.embedding.embedQuery(query);
        }
        const vectorResults = await this.vectorSearch(
          queryEmbedding,
          orgSlug,
          fileIds,
          topK,
          folderPath,
          metadataFilters,
        );
        const results: SearchResultRow[] = vectorResults.map((item) => ({
          content: item.core_content || item.chunk_content || '',
          score: item.score,
          file_id: item.file_id ?? null,
          filename: item.filename,
          source_created_at: item.source_created_at,
          source_modified_at: item.source_modified_at,
        }));
        return [results, usage];
      }
      throw err;
    }
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const cachedResultSchema = z.object({
  content: z.string().default(''),
  score: z.number().default(0),
  file_id: z.string().nullable().default(null),
  filename: z.string().nullable().default(null),
  source_created_at: z.coerce.date().nullable().default(null),
  source_modified_at: z.coerce.date().nullable().default(null),
});

/** Parse a serialized cached result list, returning null on any malformation. */
function parseCachedResults(responseText: string): SearchResultRow[] | null {
  try {
    const parsed = z
      .array(cachedResultSchema)
      .safeParse(JSON.parse(responseText));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Scale RRF scores by document age so newer documents rank higher. */
export function applyRecencyBoost(
  results: MergedRow[],
  decayBase: number,
  maxAgeDays: number,
): void {
  const now = Date.now();
  for (const item of results) {
    const docTs = item.source_modified_at ?? item.created_at;
    const rrfScore = item.rrf_score ?? 0;
    if (docTs == null) {
      item.rrf_score = rrfScore * decayBase;
      continue;
    }
    const ageDays = (now - new Date(docTs).getTime()) / (86400 * 1000);
    const recencyFactor = Math.max(0.0, 1.0 - ageDays / maxAgeDays);
    const boost = decayBase + (1.0 - decayBase) * recencyFactor;
    item.rrf_score = rrfScore * boost;
  }
  results.sort((a, b) => (b.rrf_score ?? 0) - (a.rrf_score ?? 0));
}
