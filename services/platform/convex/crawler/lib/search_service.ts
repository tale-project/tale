'use node';

/**
 * Hybrid search service for the crawler corpus (`public_web` schema).
 *
 * Faithful port of `services/crawler/app/services/search_service.py`.
 *
 * BM25 full-text (pg_search / paradedb) + pgvector similarity with RRF fusion.
 * Chunks/websites are deployment-shared content, but each search is restricted
 * to domains the caller's org has registered (the `website_org_memberships`
 * EXISTS filter). The Python source resolved the active org via a global
 * `get_active_org()`; here the `orgSlug` is threaded through explicitly.
 *
 * The query embedding is produced by an `EmbeddingService` built from the org's
 * provider config (the Python source used a global embedding service).
 */

import { getEmbeddingConfig } from '../../lib/knowledge/config/base';
import { PUBLIC_WEB_SCHEMA as SCHEMA } from '../../lib/knowledge/db/knowledge_db';
import { getKnowledgePool } from '../../lib/knowledge/db/knowledge_db';
import { withRetry } from '../../lib/knowledge/db/retry';
import { EmbeddingService } from '../../lib/knowledge/embedding/service';
import { logger } from '../../lib/knowledge/logger';

const RRF_K = 60;

export interface SearchResult {
  url: string;
  title: string | null;
  chunk_content: string;
  chunk_index: number;
  score: number;
  // Populated for chunks indexed after the refactor; empty string for legacy
  // rows. Consumers should prefer this field over `chunk_content`.
  core_content: string;
}

interface ChunkRow {
  id: number;
  url: string;
  title: string | null;
  chunk_content: string;
  core_content: string | null;
  chunk_index: number;
  score: number;
}

export interface SearchWebOptions {
  domain?: string | null;
  limit?: number;
  similarityThreshold?: number;
}

async function ftsSearch(
  query: string,
  orgSlug: string,
  domain: string | null,
  limit: number,
): Promise<ChunkRow[]> {
  const sql = getKnowledgePool();
  // Membership filter restricts the org's view to domains it has registered.
  if (domain) {
    return withRetry(() =>
      sql.unsafe<ChunkRow[]>(
        `SELECT c.id, c.url, c.title, c.chunk_content, c.core_content, c.chunk_index,
                              paradedb.score(c.id) AS score
                       FROM ${SCHEMA}.chunks c
                       WHERE c.id @@@ paradedb.match('chunk_content', $1)
                         AND c.domain = $2
                         AND EXISTS (
                             SELECT 1 FROM ${SCHEMA}.website_org_memberships m
                             WHERE m.domain = c.domain AND m.org_slug = $3
                         )
                       ORDER BY score DESC
                       LIMIT $4`,
        [query, domain, orgSlug, limit],
      ),
    );
  }
  return withRetry(() =>
    sql.unsafe<ChunkRow[]>(
      `SELECT c.id, c.url, c.title, c.chunk_content, c.core_content, c.chunk_index,
                              paradedb.score(c.id) AS score
                       FROM ${SCHEMA}.chunks c
                       WHERE c.id @@@ paradedb.match('chunk_content', $1)
                         AND EXISTS (
                             SELECT 1 FROM ${SCHEMA}.website_org_memberships m
                             WHERE m.domain = c.domain AND m.org_slug = $2
                         )
                       ORDER BY score DESC
                       LIMIT $3`,
      [query, orgSlug, limit],
    ),
  );
}

async function vectorSearch(
  embedding: number[],
  orgSlug: string,
  domain: string | null,
  limit: number,
): Promise<ChunkRow[]> {
  const sql = getKnowledgePool();
  const vecStr = JSON.stringify(embedding);
  if (domain) {
    return withRetry(() =>
      sql.unsafe<ChunkRow[]>(
        `SELECT c.id, c.url, c.title, c.chunk_content, c.core_content, c.chunk_index,
                              1 - (c.embedding <=> $1::vector) AS score
                       FROM ${SCHEMA}.chunks c
                       WHERE c.domain = $2 AND c.embedding IS NOT NULL
                         AND EXISTS (
                             SELECT 1 FROM ${SCHEMA}.website_org_memberships m
                             WHERE m.domain = c.domain AND m.org_slug = $3
                         )
                       ORDER BY c.embedding <=> $1::vector
                       LIMIT $4`,
        [vecStr, domain, orgSlug, limit],
      ),
    );
  }
  return withRetry(() =>
    sql.unsafe<ChunkRow[]>(
      `SELECT c.id, c.url, c.title, c.chunk_content, c.core_content, c.chunk_index,
                              1 - (c.embedding <=> $1::vector) AS score
                       FROM ${SCHEMA}.chunks c
                       WHERE c.embedding IS NOT NULL
                         AND EXISTS (
                             SELECT 1 FROM ${SCHEMA}.website_org_memberships m
                             WHERE m.domain = c.domain AND m.org_slug = $2
                         )
                       ORDER BY c.embedding <=> $1::vector
                       LIMIT $3`,
      [vecStr, orgSlug, limit],
    ),
  );
}

/**
 * Reciprocal Rank Fusion over the FTS + vector lists.
 *
 * Reproduces `SearchService._merge_rrf` exactly: RRF accumulation with k=60,
 * then normalization against the theoretical max
 * `num_contributing / (RRF_K + 1)` so scores reflect absolute quality.
 */
function mergeRrf(rankedLists: ChunkRow[][], limit: number): SearchResult[] {
  const scores = new Map<number, number>();
  const items = new Map<number, ChunkRow>();

  for (const ranked of rankedLists) {
    for (let rank = 0; rank < ranked.length; rank += 1) {
      const item = ranked[rank];
      const itemId = item.id;
      const rrfScore = 1.0 / (RRF_K + rank + 1);
      scores.set(itemId, (scores.get(itemId) ?? 0.0) + rrfScore);
      items.set(itemId, item);
    }
  }

  const sortedIds = [...scores.keys()]
    .sort((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0))
    .slice(0, limit);

  const numContributing = Math.max(
    1,
    rankedLists.reduce((acc, list) => acc + (list.length > 0 ? 1 : 0), 0),
  );
  const maxScore = sortedIds.length > 0 ? numContributing / (RRF_K + 1) : 1.0;

  return sortedIds.map((itemId) => {
    const item = items.get(itemId);
    if (item === undefined) {
      throw new Error('RRF internal invariant violated: missing scored item');
    }
    return {
      url: item.url,
      title: item.title ?? null,
      chunk_content: item.chunk_content,
      chunk_index: item.chunk_index,
      score: (scores.get(itemId) ?? 0) / maxScore,
      core_content: item.core_content ?? '',
    };
  });
}

/**
 * Hybrid search across the org's registered web corpus.
 *
 * Runs the FTS and vector searches (and the query embed) in parallel, pre-filters
 * vector results by cosine similarity, then RRF-merges.
 */
export async function searchWeb(
  orgSlug: string,
  query: string,
  options: SearchWebOptions = {},
): Promise<SearchResult[]> {
  const domain = options.domain ?? null;
  const limit = options.limit ?? 10;
  const similarityThreshold = options.similarityThreshold ?? 0.4;

  const cfg = getEmbeddingConfig(orgSlug);
  const emb = new EmbeddingService(
    cfg.apiKey,
    cfg.baseUrl,
    cfg.modelId,
    cfg.dimensions,
  );

  // Generate query embedding and run FTS in parallel (matches the Python
  // asyncio.create_task fan-out).
  const [queryEmbedding, ftsResults] = await Promise.all([
    emb.embedQuery(query),
    ftsSearch(query, orgSlug, domain, limit * 3),
  ]);

  let vectorResults = await vectorSearch(
    queryEmbedding,
    orgSlug,
    domain,
    limit * 3,
  );

  // Pre-filter vector results by cosine similarity (matches RAG pipeline). If
  // ALL vector results fall below the threshold the query is considered
  // semantically irrelevant — discard FTS results too (keyword noise).
  if (similarityThreshold > 0) {
    const preCount = vectorResults.length;
    const topScore = vectorResults.reduce(
      (max, r) => (r.score > max ? r.score : max),
      0.0,
    );
    vectorResults = vectorResults.filter((r) => r.score >= similarityThreshold);
    if (preCount !== vectorResults.length) {
      logger.debug(
        `Vector pre-filter: ${vectorResults.length}/${preCount} results passed ` +
          `threshold ${similarityThreshold} (top score ${topScore.toFixed(3)})`,
      );
    }
    if (preCount > 0 && vectorResults.length === 0) {
      return [];
    }
  }

  return mergeRrf([ftsResults, vectorResults], limit);
}
