/**
 * Conversations Queries
 *
 * All query operations for conversations.
 * Business logic is in ./helpers.ts
 */

import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';

import { queryWithRLS } from '../lib/rls';
import * as ConversationsHelpers from './helpers';
import { listConversationsPaginated as listConversationsPaginatedHelper } from './list_conversations_paginated';
import { transformConversation } from './transform_conversation';
import { conversationWithMessagesValidator } from './validators';

export const listConversationsPaginated = queryWithRLS({
  args: {
    paginationOpts: paginationOptsValidator,
    organizationId: v.string(),
    status: v.optional(v.string()),
    priority: v.optional(v.string()),
    channel: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await listConversationsPaginatedHelper(ctx, args);
  },
});

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

const CONVERSATIONS_COUNT_CAP = 20;

export const approxCountConversations = queryWithRLS({
  args: {
    organizationId: v.string(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    let count = 0;
    for await (const _ of ctx.db
      .query('conversations')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      count++;
      if (count >= CONVERSATIONS_COUNT_CAP) break;
    }
    return count;
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
