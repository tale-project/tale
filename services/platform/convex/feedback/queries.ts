import { v } from 'convex/values';

import { query } from '../_generated/server';
import { authComponent } from '../auth';
import { getOrganizationMember } from '../lib/rls';

export const getMessageFeedback = query({
  args: {
    messageId: v.string(),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) return null;

    const userId = String(authUser._id);

    return await ctx.db
      .query('messageFeedback')
      .withIndex('by_messageId_userId', (q) =>
        q.eq('messageId', args.messageId).eq('userId', userId),
      )
      .first();
  },
});

export const getFeedbackStats = query({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) return null;

    await getOrganizationMember(ctx, args.organizationId);

    let positive = 0;
    let negative = 0;

    const feedbackQuery = ctx.db
      .query('messageFeedback')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      );

    for await (const feedback of feedbackQuery) {
      if (feedback.rating === 'positive') positive++;
      else negative++;
    }

    return { positive, negative, total: positive + negative };
  },
});
