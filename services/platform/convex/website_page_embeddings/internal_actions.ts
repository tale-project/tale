/**
 * Internal Actions for Website Page Embeddings
 *
 * Handles embedding generation (chunking + agent component) and vector search.
 */

import { embedMany } from '@convex-dev/agent';
import { v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';

import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';
import { createDebugLog } from '../lib/debug_log';
import {
  getEmbeddingDimension,
  getTextEmbeddingModel,
} from '../lib/embedding_config';
import { classifyError } from '../lib/error_classification';
import { chunkContent } from './chunk_content';
import { computeContentHash } from './content_hash';
import { mergeWithRRF } from './rrf';

const RETRY_DELAY_MS = 30_000;

const debugLog = createDebugLog('DEBUG_EMBEDDINGS', '[WebsitePageEmbeddings]');

export const generateForPage = internalAction({
  args: {
    organizationId: v.string(),
    websiteId: v.id('websites'),
    pageId: v.id('websitePages'),
    retryCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { organizationId, websiteId, pageId } = args;
    const retryCount = args.retryCount ?? 0;
    const dimension = getEmbeddingDimension();

    debugLog('generateForPage start', { pageId, dimension, retryCount });

    // 1. Load page content
    const page = await ctx.runQuery(
      internal.website_page_embeddings.internal_queries.getPageById,
      { pageId },
    );

    if (!page || !page.content) {
      debugLog('generateForPage skip - no content', { pageId });
      return { status: 'skipped', reason: 'no_content' };
    }

    // 2. Check content hash to skip if unchanged
    const contentHash = computeContentHash(page.content);
    const existing = await ctx.runQuery(
      internal.website_page_embeddings.internal_queries
        .getExistingEmbeddingHash,
      { organizationId, pageId, dimension },
    );

    if (existing?.contentHash === contentHash) {
      debugLog('generateForPage skip - content unchanged', {
        pageId,
        contentHash,
      });
      return { status: 'skipped', reason: 'unchanged' };
    }

    // 3. Chunk content
    const chunks = chunkContent(page.content, page.title);
    if (chunks.length === 0) {
      debugLog('generateForPage skip - no chunks', { pageId });
      return { status: 'skipped', reason: 'no_chunks' };
    }

    debugLog('generateForPage chunked', {
      pageId,
      chunkCount: chunks.length,
    });

    // 4. Generate embeddings via agent component
    let embeddings: number[][];
    try {
      const textEmbeddingModel = getTextEmbeddingModel();
      const result = await embedMany(ctx, {
        userId: undefined,
        threadId: undefined,
        values: chunks.map((c) => c.content),
        textEmbeddingModel,
      });
      embeddings = result.embeddings;
    } catch (error) {
      const classification = classifyError(error);

      if (classification.shouldRetry && retryCount < 1) {
        debugLog('generateForPage embedMany failed, scheduling retry', {
          pageId,
          retryCount,
          reason: classification.reason,
          delayMs: RETRY_DELAY_MS,
        });
        await ctx.scheduler.runAfter(
          RETRY_DELAY_MS,
          internal.website_page_embeddings.internal_actions.generateForPage,
          { organizationId, websiteId, pageId, retryCount: retryCount + 1 },
        );
        return { status: 'retry_scheduled', reason: classification.reason };
      }

      debugLog('generateForPage embedMany failed, no retry', {
        pageId,
        retryCount,
        reason: classification.reason,
      });
      throw error;
    }

    debugLog('generateForPage embedded', {
      pageId,
      embeddingCount: embeddings.length,
      dimension,
    });

    // 5. Delete old embeddings for this page
    await ctx.runMutation(
      internal.website_page_embeddings.internal_mutations.deleteByPageId,
      { organizationId, pageId, dimension },
    );

    // 6. Store new embeddings
    const insertMutation = getInsertMutation(dimension);
    for (const [i, chunk] of chunks.entries()) {
      await ctx.runMutation(insertMutation, {
        organizationId,
        websiteId,
        pageId,
        embedding: embeddings[i],
        url: page.url,
        title: page.title,
        contentHash,
        chunkIndex: chunk.index,
        chunkContent: chunk.content,
      });
    }

    debugLog('generateForPage complete', {
      pageId,
      chunksStored: chunks.length,
    });

    return { status: 'success', chunks: chunks.length };
  },
});

interface SearchResult {
  url: string;
  title?: string;
  chunkContent: string;
  chunkIndex: number;
  score: number;
}

export const search = internalAction({
  args: {
    organizationId: v.string(),
    websiteId: v.optional(v.id('websites')),
    query: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<SearchResult[]> => {
    const { organizationId, query, limit = 10 } = args;
    const dimension = getEmbeddingDimension();

    debugLog('search start', { organizationId, query, dimension });

    // 1. Generate query embedding via agent component (with inline retry)
    const textEmbeddingModel = getTextEmbeddingModel();
    let queryEmbedding: number[];

    try {
      const result = await embedMany(ctx, {
        userId: undefined,
        threadId: undefined,
        values: [query],
        textEmbeddingModel,
      });
      queryEmbedding = result.embeddings[0];
    } catch (error) {
      const classification = classifyError(error);
      if (!classification.shouldRetry) throw error;

      debugLog('search embedMany failed, retrying inline', {
        query,
        reason: classification.reason,
      });
      await new Promise((resolve) => setTimeout(resolve, 1_000));

      const retryResult = await embedMany(ctx, {
        userId: undefined,
        threadId: undefined,
        values: [query],
        textEmbeddingModel,
      });
      queryEmbedding = retryResult.embeddings[0];
    }

    // 2. Run vector search + full-text search in parallel
    const searchLimit = args.websiteId ? Math.min(limit * 3, 256) : limit;

    const [vectorResults, fullTextResults] = await Promise.all([
      runVectorSearch(
        ctx,
        dimension,
        queryEmbedding,
        organizationId,
        searchLimit,
      ),
      ctx.runQuery(
        internal.website_page_embeddings.internal_queries.fullTextSearch,
        {
          organizationId,
          websiteId: args.websiteId,
          query,
          limit: searchLimit,
          dimension,
        },
      ),
    ]);

    // 3. Fetch full records for vector results
    const vectorRecords = await fetchResultRecords(
      ctx,
      dimension,
      vectorResults,
    );

    // 4. Build ranked lists for RRF merge
    const vectorRanked = vectorRecords
      .map((record, i) =>
        record
          ? {
              id: vectorResults[i]._id,
              url: record.url,
              title: record.title,
              chunkContent: record.chunkContent,
              chunkIndex: record.chunkIndex,
              websiteId: record.websiteId,
            }
          : null,
      )
      .filter((r): r is NonNullable<typeof r> => r != null)
      .filter((r) => !args.websiteId || r.websiteId === args.websiteId);

    const ftRanked = fullTextResults.map((r) => ({
      id: r._id,
      url: r.url,
      title: r.title,
      chunkContent: r.chunkContent,
      chunkIndex: r.chunkIndex,
      websiteId: r.websiteId,
    }));

    // 5. Merge with RRF
    const merged = mergeWithRRF([vectorRanked, ftRanked], limit);

    debugLog('search complete', {
      query,
      vectorCount: vectorRanked.length,
      ftCount: ftRanked.length,
      mergedCount: merged.length,
    });

    return merged.map((r) => ({
      url: r.url,
      title: r.title,
      chunkContent: r.chunkContent,
      chunkIndex: r.chunkIndex,
      score: r.score,
    }));
  },
});

function getInsertMutation(dimension: number) {
  switch (dimension) {
    case 256:
      return internal.website_page_embeddings.internal_mutations
        .insertEmbedding256;
    case 512:
      return internal.website_page_embeddings.internal_mutations
        .insertEmbedding512;
    case 1024:
      return internal.website_page_embeddings.internal_mutations
        .insertEmbedding1024;
    case 1536:
      return internal.website_page_embeddings.internal_mutations
        .insertEmbedding1536;
    case 2048:
      return internal.website_page_embeddings.internal_mutations
        .insertEmbedding2048;
    case 2560:
      return internal.website_page_embeddings.internal_mutations
        .insertEmbedding2560;
    case 4096:
      return internal.website_page_embeddings.internal_mutations
        .insertEmbedding4096;
    default:
      throw new Error(`Unsupported embedding dimension: ${dimension}`);
  }
}

interface VectorSearchResult {
  _id: string;
  _score: number;
}

async function runVectorSearch(
  ctx: ActionCtx,
  dimension: number,
  vector: number[],
  organizationId: string,
  limit: number,
): Promise<VectorSearchResult[]> {
  // Convex vector search filters only support eq + or (no and), so we filter
  // by organizationId here and post-filter by websiteId in the caller.
  switch (dimension) {
    case 256:
      return ctx.vectorSearch('websitePageEmbeddings256', 'by_embedding', {
        vector,
        limit,
        filter: (q) => q.eq('organizationId', organizationId),
      });
    case 512:
      return ctx.vectorSearch('websitePageEmbeddings512', 'by_embedding', {
        vector,
        limit,
        filter: (q) => q.eq('organizationId', organizationId),
      });
    case 1024:
      return ctx.vectorSearch('websitePageEmbeddings1024', 'by_embedding', {
        vector,
        limit,
        filter: (q) => q.eq('organizationId', organizationId),
      });
    case 1536:
      return ctx.vectorSearch('websitePageEmbeddings1536', 'by_embedding', {
        vector,
        limit,
        filter: (q) => q.eq('organizationId', organizationId),
      });
    case 2048:
      return ctx.vectorSearch('websitePageEmbeddings2048', 'by_embedding', {
        vector,
        limit,
        filter: (q) => q.eq('organizationId', organizationId),
      });
    case 2560:
      return ctx.vectorSearch('websitePageEmbeddings2560', 'by_embedding', {
        vector,
        limit,
        filter: (q) => q.eq('organizationId', organizationId),
      });
    case 4096:
      return ctx.vectorSearch('websitePageEmbeddings4096', 'by_embedding', {
        vector,
        limit,
        filter: (q) => q.eq('organizationId', organizationId),
      });
    default:
      return [];
  }
}

interface EmbeddingRecord {
  url: string;
  title?: string;
  chunkContent: string;
  chunkIndex: number;
  websiteId: Id<'websites'>;
}

async function fetchResultRecords(
  ctx: ActionCtx,
  dimension: number,
  results: VectorSearchResult[],
): Promise<Array<EmbeddingRecord | null>> {
  const ids = results.map((r) => r._id);

  switch (dimension) {
    case 256:
      return await ctx.runQuery(
        internal.website_page_embeddings.internal_queries.fetchSearchResults256,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- vectorSearch returns string IDs that match the table's Id type
        { ids: ids as unknown as Id<'websitePageEmbeddings256'>[] },
      );
    case 512:
      return await ctx.runQuery(
        internal.website_page_embeddings.internal_queries.fetchSearchResults512,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- vectorSearch returns string IDs that match the table's Id type
        { ids: ids as unknown as Id<'websitePageEmbeddings512'>[] },
      );
    case 1024:
      return await ctx.runQuery(
        internal.website_page_embeddings.internal_queries
          .fetchSearchResults1024,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- vectorSearch returns string IDs that match the table's Id type
        { ids: ids as unknown as Id<'websitePageEmbeddings1024'>[] },
      );
    case 1536:
      return await ctx.runQuery(
        internal.website_page_embeddings.internal_queries
          .fetchSearchResults1536,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- vectorSearch returns string IDs that match the table's Id type
        { ids: ids as unknown as Id<'websitePageEmbeddings1536'>[] },
      );
    case 2048:
      return await ctx.runQuery(
        internal.website_page_embeddings.internal_queries
          .fetchSearchResults2048,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- vectorSearch returns string IDs that match the table's Id type
        { ids: ids as unknown as Id<'websitePageEmbeddings2048'>[] },
      );
    case 2560:
      return await ctx.runQuery(
        internal.website_page_embeddings.internal_queries
          .fetchSearchResults2560,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- vectorSearch returns string IDs that match the table's Id type
        { ids: ids as unknown as Id<'websitePageEmbeddings2560'>[] },
      );
    case 4096:
      return await ctx.runQuery(
        internal.website_page_embeddings.internal_queries
          .fetchSearchResults4096,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- vectorSearch returns string IDs that match the table's Id type
        { ids: ids as unknown as Id<'websitePageEmbeddings4096'>[] },
      );
    default:
      return [];
  }
}
