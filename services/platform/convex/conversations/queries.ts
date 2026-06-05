/**
 * Conversations Queries
 *
 * All query operations for conversations.
 */

import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import { DEFAULT_COUNT_CAP } from '../lib/helpers/count_items_in_org';
import { queryWithRLS } from '../lib/rls/helpers/query_with_rls';
import { getConversationWithMessages as getConversationWithMessagesHelper } from './get_conversation_with_messages';
import { listConversationsPaginated as listConversationsPaginatedHelper } from './list_conversations_paginated';
import { transformConversation } from './transform_conversation';
import {
  conversationStatusValidator,
  conversationWithMessagesValidator,
} from './validators';

export const listConversationsPaginated = queryWithRLS({
  args: {
    paginationOpts: paginationOptsValidator,
    organizationId: v.string(),
    status: v.optional(conversationStatusValidator),
    priority: v.optional(v.string()),
    channel: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await listConversationsPaginatedHelper(ctx, args);
  },
});

// Hard cap for the non-paginated variant below. Prefer
// `listConversationsPaginated` for any growing list — this bounded form exists
// for small orgs / simple callers and must not degrade into a full-table scan
// (plus per-row transform fan-out) on a large org.
const LIST_CONVERSATIONS_CAP = 500;

export const listConversations = queryWithRLS({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const conversations: Doc<'conversations'>[] = [];
    for await (const conversation of ctx.db
      .query('conversations')
      .withIndex('by_org_lastMessageAt', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .order('desc')) {
      conversations.push(conversation);
      if (conversations.length >= LIST_CONVERSATIONS_CAP) break;
    }
    return await Promise.all(
      conversations.map((c) => transformConversation(ctx, c)),
    );
  },
});

export const approxCountConversationsByStatus = queryWithRLS({
  args: {
    organizationId: v.string(),
    status: v.union(
      v.literal('open'),
      v.literal('closed'),
      v.literal('spam'),
      v.literal('archived'),
    ),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    let count = 0;
    for await (const _ of ctx.db
      .query('conversations')
      .withIndex('by_organizationId_and_status', (q) =>
        q.eq('organizationId', args.organizationId).eq('status', args.status),
      )) {
      count++;
      if (count >= DEFAULT_COUNT_CAP) break;
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
    return await getConversationWithMessagesHelper(ctx, args.conversationId);
  },
});
