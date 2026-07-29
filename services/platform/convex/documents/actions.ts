'use node';

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { action } from '../_generated/server';
import {
  RateLimitExceededError,
  checkUserRateLimit,
} from '../lib/rate_limiter/helpers';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';

// `ragAction` (`convex/workflow_engine/action_defs/rag/rag_action`)
// moved out with the RAG rewrite. `retryRagIndexing` is the user-triggered
// "Retry"/"Reindex" affordance (`RagStatusBadge`, `DocumentRowActions`,
// `project-files-tab.tsx`) — offline per the stub policy. It keeps returning
// its established `{ success, error? }` shape (never throws) rather than a
// thrown `ConvexError`: every existing failure path here already reports
// through that shape, and the frontend's blanket `catch` for a thrown error
// shows a generic "unexpected error" toast with no message, while the
// `success: false` path shows the actual `error` string — so the shaped
// result is the more informative surface for this specific caller.
// Auth/rate-limit checks are preserved (no AI dependency, still correct).

export const retryRagIndexing = action({
  args: {
    documentId: v.id('documents'),
  },
  returns: v.object({
    success: v.boolean(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      return { success: false, error: 'Unauthenticated' };
    }

    try {
      await checkUserRateLimit(ctx, 'file:rag-retry', authUser.userId);
    } catch (error) {
      if (error instanceof RateLimitExceededError) {
        return { success: false, error: error.message };
      }
      throw error;
    }

    const document = await ctx.runQuery(
      internal.documents.internal_queries.getDocumentByIdRaw,
      { documentId: args.documentId },
    );
    if (!document) {
      return { success: false, error: 'Document not found' };
    }

    const isMember = await ctx.runQuery(
      internal.documents.internal_queries.verifyOrganizationMembership,
      {
        organizationId: document.organizationId,
        userId: authUser.userId,
      },
    );
    if (!isMember) {
      return { success: false, error: 'Unauthorized' };
    }

    console.debug(
      `[retryRagIndexing] RAG indexing is offline while the platform AI backend is rewritten; declining retry for document ${args.documentId}`,
    );
    return {
      success: false,
      error:
        'RAG re-indexing is offline while the platform AI backend is rewritten.',
    };
  },
});
