import { ConvexError, v } from 'convex/values';

import { mutation } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { OrganizationMismatchError } from '../lib/rls/errors';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';

/**
 * Rate one assistant message. The target is validated against the chat-v2
 * tables: the thread must be the CALLER'S OWN conversation in the claimed
 * organization, and the message an assistant row of that thread — so feedback
 * can neither cross organizations nor land on another member's conversation.
 *
 * Attribution (`agentSlug`, `model`, `provider`) is stamped SERVER-SIDE from
 * the thread and message rows at submit time, on insert and on re-rate alike.
 * The client never supplies it — a mislabeled model would poison the
 * feedback analytics this table feeds.
 */
export const submitFeedback = mutation({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    messageId: v.string(),
    rating: v.union(v.literal('positive'), v.literal('negative')),
    comment: v.optional(v.string()),
    /** Arena verdict context. Regular message feedback never carries it —
     * the arena settle flow writes its rows with this shape. */
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
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new Error('Unauthenticated');
    await getOrganizationMember(ctx, args.organizationId);
    const userId = authUser.userId;

    const threadId = ctx.db.normalizeId('threads', args.threadId);
    const thread = threadId ? await ctx.db.get(threadId) : null;
    if (!thread || thread.userId !== userId) {
      throw new ConvexError({
        code: 'not_found',
        message: 'This conversation does not exist.',
      });
    }
    if (thread.organizationId !== args.organizationId) {
      throw new OrganizationMismatchError();
    }

    const messageId = ctx.db.normalizeId('messages', args.messageId);
    const message = messageId ? await ctx.db.get(messageId) : null;
    if (
      !message ||
      message.threadId !== String(thread._id) ||
      message.role !== 'assistant'
    ) {
      throw new ConvexError({
        code: 'not_found',
        message: 'Only an assistant reply of this conversation can be rated.',
      });
    }

    const attribution = {
      agentSlug: thread.agentSlug,
      model: message.model,
      provider: message.providerSlug,
    };

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
        ...attribution,
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
      ...attribution,
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
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    await getOrganizationMember(ctx, args.organizationId);

    const userId = authUser.userId;

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
