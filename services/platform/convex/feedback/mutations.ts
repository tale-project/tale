import { v } from 'convex/values';

import { mutation } from '../_generated/server';
import { authComponent } from '../auth';
import { getOrganizationMember } from '../lib/rls';
import { OrganizationMismatchError } from '../lib/rls/errors';

const ARENA_MESSAGE_ID_PREFIX = 'arena:';

export const submitFeedback = mutation({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    messageId: v.string(),
    rating: v.union(v.literal('positive'), v.literal('negative')),
    comment: v.optional(v.string()),
    metadata: v.optional(
      v.object({
        arenaVerdict: v.optional(v.string()),
        modelA: v.optional(v.string()),
        modelB: v.optional(v.string()),
      }),
    ),
  },
  returns: v.id('messageFeedback'),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    await getOrganizationMember(ctx, args.organizationId);

    // Reject cross-org writes: feedback must be tagged with the org that
    // owns the source thread, not whatever the client supplies. Arena rows
    // use a synthetic messageId (arena:<a>:<b>) but still reference a real
    // threadId, so the same check applies.
    const threadMeta = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
      .first();
    if (
      threadMeta &&
      threadMeta.organizationId &&
      threadMeta.organizationId !== args.organizationId
    ) {
      throw new OrganizationMismatchError();
    }

    // Server-side attribution capture: read the source message's metadata
    // (model / provider / agentSlug) and copy into the feedback row. We do
    // not trust client-supplied attribution. Arena rows skip the lookup —
    // their messageId is synthetic, and arena attribution lives in
    // metadata.modelA/modelB which the client supplies and we do not bind
    // to an agent.
    let agentSlug: string | undefined;
    let model: string | undefined;
    let provider: string | undefined;
    if (!args.messageId.startsWith(ARENA_MESSAGE_ID_PREFIX)) {
      const msgMeta = await ctx.db
        .query('messageMetadata')
        .withIndex('by_messageId', (q) => q.eq('messageId', args.messageId))
        .first();
      if (msgMeta) {
        agentSlug = msgMeta.agentSlug;
        model = msgMeta.model || undefined;
        provider = msgMeta.provider || undefined;
      }
    }

    const userId = String(authUser._id);

    const existing = await ctx.db
      .query('messageFeedback')
      .withIndex('by_messageId_userId', (q) =>
        q.eq('messageId', args.messageId).eq('userId', userId),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        rating: args.rating,
        comment: args.comment,
        metadata: args.metadata,
        agentSlug: agentSlug ?? existing.agentSlug,
        model: model ?? existing.model,
        provider: provider ?? existing.provider,
      });
      return existing._id;
    }

    return await ctx.db.insert('messageFeedback', {
      organizationId: args.organizationId,
      threadId: args.threadId,
      messageId: args.messageId,
      userId,
      rating: args.rating,
      comment: args.comment,
      metadata: args.metadata,
      agentSlug,
      model,
      provider,
      createdAt: Date.now(),
    });
  },
});

export const deleteFeedback = mutation({
  args: {
    organizationId: v.string(),
    messageId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    await getOrganizationMember(ctx, args.organizationId);

    const userId = String(authUser._id);

    const existing = await ctx.db
      .query('messageFeedback')
      .withIndex('by_messageId_userId', (q) =>
        q.eq('messageId', args.messageId).eq('userId', userId),
      )
      .first();

    if (existing) {
      // Defense in depth: never delete a row whose stored organizationId
      // does not match the one the caller claims to be operating in. The
      // by_messageId_userId scope already constrains by userId, but cross-
      // membership users could theoretically delete the wrong row if the
      // mutation trusted args.organizationId blindly.
      if (existing.organizationId !== args.organizationId) {
        throw new OrganizationMismatchError();
      }
      await ctx.db.delete(existing._id);
    }

    return null;
  },
});
