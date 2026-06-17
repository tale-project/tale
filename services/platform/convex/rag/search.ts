'use node';

/**
 * Internal actions for RAG search + generation.
 *
 * Thin Convex wrappers over the ported `RagService` singleton (in
 * `./lib/rag_service`). The singleton holds the knowledge-db pool + per-org
 * client cache; module-level state persists across action calls within an
 * isolate, so the cache survives between invocations.
 *
 * Date fields are serialized to ISO strings before returning — Convex action
 * return values must be JSON values (no `Date` objects).
 */

import { v } from 'convex/values';

import { internalAction } from '../_generated/server';
import { ragService } from './lib/rag_service';
import type { SearchResultRow } from './lib/search_service';

/** Convert a search result row's `Date` fields to ISO strings. */
function serializeSearchResult(row: SearchResultRow): {
  content: string;
  score: number;
  file_id: string | null;
  filename: string | null;
  source_created_at: string | null;
  source_modified_at: string | null;
  cached: boolean;
} {
  return {
    content: row.content,
    score: row.score,
    file_id: row.file_id,
    filename: row.filename,
    source_created_at: row.source_created_at
      ? row.source_created_at.toISOString()
      : null,
    source_modified_at: row.source_modified_at
      ? row.source_modified_at.toISOString()
      : null,
    cached: row.cached ?? false,
  };
}

export const search = internalAction({
  args: {
    orgSlug: v.string(),
    query: v.string(),
    topK: v.optional(v.union(v.number(), v.null())),
    similarityThreshold: v.optional(v.union(v.number(), v.null())),
    fileIds: v.optional(v.union(v.array(v.string()), v.null())),
    folderPath: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (_ctx, args) => {
    const [results, usage] = await ragService.search(args.orgSlug, args.query, {
      topK: args.topK ?? null,
      similarityThreshold: args.similarityThreshold ?? null,
      fileIds: args.fileIds ?? null,
      folderPath: args.folderPath ?? null,
    });
    return {
      results: results.map(serializeSearchResult),
      usage,
    };
  },
});

export const generate = internalAction({
  args: {
    orgSlug: v.string(),
    query: v.string(),
    fileIds: v.optional(v.union(v.array(v.string()), v.null())),
  },
  handler: async (_ctx, args) => {
    const result = await ragService.generate(
      args.orgSlug,
      args.query,
      args.fileIds ?? null,
    );
    return {
      success: result.success,
      response: result.response,
      sources: result.sources.map(serializeSearchResult),
      processing_time_ms: result.processing_time_ms,
      usage: result.usage ?? null,
    };
  },
});
