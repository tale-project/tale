'use node';

/**
 * Internal action for hybrid web-corpus search.
 *
 * Wraps `searchWeb` (lib/search_service). Replaces the Python crawler's
 * `POST /api/v1/search` and `POST /api/v1/search/{domain}` endpoints — the
 * platform `search_pages.ts` caller passes `{ query, limit, similarity_threshold }`
 * (+ optional domain) and expects back a list of
 * `{ url, title, chunk_content, chunk_index, score, core_content }`.
 *
 * Return values are JSON-serializable (no Date objects). `returns` validators
 * are intentionally omitted (allowed for actions; matches the RAG port).
 */

import { v } from 'convex/values';

import { internalAction } from '../_generated/server';
import { searchWeb } from './lib/search_service';

export const search = internalAction({
  args: {
    orgSlug: v.string(),
    query: v.string(),
    domain: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
    similarityThreshold: v.optional(v.number()),
  },
  handler: async (_ctx, args) => {
    const results = await searchWeb(args.orgSlug, args.query, {
      domain: args.domain ?? null,
      limit: args.limit,
      similarityThreshold: args.similarityThreshold,
    });
    return { results };
  },
});
