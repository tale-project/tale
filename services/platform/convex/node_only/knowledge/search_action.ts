'use node';

/**
 * Knowledge retrieval as a callable internal action.
 *
 * {@link searchKnowledge} is a plain function in a `'use node'` module — it
 * needs a PostgreSQL pool and an embedding client, neither of which exists in
 * V8 — so a V8 caller (the REST handler at `POST /api/v1/knowledge/search`)
 * cannot call it directly. This is the thin action around it: it validates the
 * query, hands it to the one retrieval entry point, and turns the two refusals
 * that are the CALLER's problem into coded errors the HTTP layer can map.
 *
 * It adds no retrieval logic of its own. In particular it does not choose an
 * organization: both identifiers arrive from the authenticated API key —
 * `organizationId` addresses the embedding credential, `orgSlug` addresses the
 * corpus — so a caller can never search one organization's corpus with
 * another's credential.
 */

import { ConvexError, v } from 'convex/values';

import { internalAction } from '../../_generated/server';
import { searchKnowledge } from '../../knowledge/search';

/** Hits per search. The retrieval core caps its own legs; this bounds what a
 * single REST response carries. */
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

/** Longest query we will embed — a question, not a document. */
const MAX_QUERY = 2000;

export const searchOrgKnowledge = internalAction({
  args: {
    organizationId: v.string(),
    orgSlug: v.string(),
    query: v.string(),
    corpus: v.optional(
      v.union(v.literal('documents'), v.literal('web'), v.literal('all')),
    ),
    limit: v.optional(v.number()),
    minSimilarity: v.optional(v.number()),
  },
  returns: v.object({
    hits: v.array(
      v.object({
        id: v.string(),
        corpus: v.union(v.literal('documents'), v.literal('web')),
        text: v.string(),
        source: v.object({
          ref: v.string(),
          title: v.union(v.string(), v.null()),
          url: v.optional(v.union(v.string(), v.null())),
          modifiedAt: v.optional(v.union(v.number(), v.null())),
        }),
        chunkIndex: v.number(),
        score: v.number(),
        fusedScore: v.number(),
        rerankScore: v.optional(v.number()),
      }),
    ),
    diagnostics: v.any(),
  }),
  handler: async (ctx, args) => {
    const query = args.query.trim();
    if (query.length === 0) {
      throw new ConvexError({
        code: 'validation',
        message: '"query" must be a non-empty string',
      });
    }
    if (query.length > MAX_QUERY) {
      throw new ConvexError({
        code: 'validation',
        message: `"query" must be at most ${MAX_QUERY} characters`,
      });
    }
    const limit = Math.min(
      Math.max(1, Math.trunc(args.limit ?? DEFAULT_LIMIT)),
      MAX_LIMIT,
    );
    if (
      args.minSimilarity !== undefined &&
      (args.minSimilarity < 0 || args.minSimilarity > 1)
    ) {
      throw new ConvexError({
        code: 'validation',
        message: '"minSimilarity" must be between 0 and 1',
      });
    }

    try {
      const result = await searchKnowledge(ctx, {
        organizationId: args.organizationId,
        orgSlug: args.orgSlug,
        query,
        ...(args.corpus !== undefined && { corpus: args.corpus }),
        limit,
        ...(args.minSimilarity !== undefined && {
          minSimilarity: args.minSimilarity,
        }),
      });
      return {
        hits: result.hits.map((hit) => ({
          id: hit.id,
          corpus: hit.corpus,
          text: hit.text,
          source: {
            ref: hit.source.ref,
            title: hit.source.title,
            ...(hit.source.url !== undefined && { url: hit.source.url }),
            ...(hit.source.modifiedAt !== undefined && {
              modifiedAt: hit.source.modifiedAt,
            }),
          },
          chunkIndex: hit.chunkIndex,
          score: hit.score,
          fusedScore: hit.fusedScore,
          ...(hit.rerankScore !== undefined && {
            rerankScore: hit.rerankScore,
          }),
        })),
        diagnostics: result.diagnostics,
      };
    } catch (error) {
      if (error instanceof ConvexError) throw error;
      // Retrieval REFUSES rather than guessing when the organization has not
      // said which embedding model to use — there is no default, because a
      // guessed vector width silently corrupts a corpus. That is a
      // configuration conflict, not a server fault, so it is coded for the 409
      // the HTTP layer answers with, message and all.
      if (error instanceof Error && error.name === 'EmbeddingNotConfigured') {
        throw new ConvexError({
          code: 'KNOWLEDGE_EMBEDDING_NOT_CONFIGURED',
          message: error.message,
        });
      }
      throw error;
    }
  },
});
