/**
 * Conversations Queries
 *
 * All query operations for conversations.
 * Business logic is in ./helpers.ts
 */

import { v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';

import { queryWithRLS } from '../lib/rls';
import * as ConversationsHelpers from './helpers';
import { transformConversation } from './transform_conversation';
import { conversationWithMessagesValidator } from './validators';

export const listConversations = queryWithRLS({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const conversations: Doc<'conversations'>[] = [];
    for await (const conversation of ctx.db
      .query('conversations')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .order('desc')) {
      conversations.push(conversation);
    }
    return await Promise.all(
      conversations.map((c) => transformConversation(ctx, c)),
    );
  },
});

export const getConversationWithMessages = queryWithRLS({
  args: {
    conversationId: v.id('conversations'),
  },
  returns: v.union(conversationWithMessagesValidator, v.null()),
  handler: async (ctx, args) => {
    return await ConversationsHelpers.getConversationWithMessages(
      ctx,
      args.conversationId,
    );
  },
});
