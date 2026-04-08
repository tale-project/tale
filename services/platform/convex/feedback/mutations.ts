import { v } from 'convex/values';

import { mutation } from '../_generated/server';
import { authComponent } from '../auth';
import { getOrganizationMember } from '../lib/rls';

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
      await ctx.db.delete(existing._id);
    }

    return null;
  },
});
