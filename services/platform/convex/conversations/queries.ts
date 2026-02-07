/**
 * Conversations Queries
 *
 * All query operations for conversations.
 * Business logic is in ./helpers.ts
 */

import { v } from 'convex/values';
import { internalQuery } from '../_generated/server';
import { queryWithRLS } from '../lib/rls';
import { cursorPaginationOptsValidator } from '../lib/pagination';
import { hasRecordsInOrg } from '../lib/helpers/has_records_in_org';
import * as ConversationsHelpers from './helpers';
import {
  conversationWithMessagesValidator,
  conversationStatusValidator,
  conversationPriorityValidator,
  conversationItemValidator,
} from './validators';
import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';

const internalConversationRecordValidator = v.object({
  _id: v.id('conversations'),
  _creationTime: v.number(),
  organizationId: v.string(),
  customerId: v.optional(v.id('customers')),
  externalMessageId: v.optional(v.string()),
  subject: v.optional(v.string()),
  status: v.optional(conversationStatusValidator),
  priority: v.optional(v.string()),
  type: v.optional(v.string()),
  channel: v.optional(v.string()),
  direction: v.optional(
    v.union(v.literal('inbound'), v.literal('outbound')),
  ),
  providerId: v.optional(v.id('emailProviders')),
  lastMessageAt: v.optional(v.number()),
  metadata: v.optional(jsonRecordValidator),
});

const internalMessageRecordValidator = v.object({
  _id: v.id('conversationMessages'),
  _creationTime: v.number(),
  organizationId: v.string(),
  conversationId: v.id('conversations'),
  providerId: v.optional(v.id('emailProviders')),
  channel: v.string(),
  direction: v.union(v.literal('inbound'), v.literal('outbound')),
  externalMessageId: v.optional(v.string()),
  deliveryState: v.union(
    v.literal('queued'),
    v.literal('sent'),
    v.literal('delivered'),
    v.literal('failed'),
  ),
  content: v.string(),
  sentAt: v.optional(v.number()),
  deliveredAt: v.optional(v.number()),
  metadata: v.optional(jsonRecordValidator),
});

// =============================================================================
// INTERNAL QUERIES (without RLS)
// =============================================================================

export const getConversationById = internalQuery({
  args: {
    conversationId: v.id('conversations'),
  },
  returns: v.union(internalConversationRecordValidator, v.null()),
  handler: async (ctx, args) => {
    return await ConversationsHelpers.getConversationById(
      ctx,
      args.conversationId,
    );
  },
});

export const getConversationByExternalMessageId = internalQuery({
  args: {
    organizationId: v.string(),
    externalMessageId: v.string(),
  },
  returns: v.union(internalConversationRecordValidator, v.null()),
  handler: async (ctx, args) => {
    return await ConversationsHelpers.getConversationByExternalMessageId(
      ctx,
      args.organizationId,
      args.externalMessageId,
    );
  },
});

export const getMessageByExternalId = internalQuery({
  args: {
    organizationId: v.string(),
    externalMessageId: v.string(),
  },
  returns: v.union(internalMessageRecordValidator, v.null()),
  handler: async (ctx, args) => {
    return await ConversationsHelpers.getMessageByExternalId(
      ctx,
      args.organizationId,
      args.externalMessageId,
    );
  },
});

export const queryConversations = internalQuery({
  args: {
    organizationId: v.string(),
    customerId: v.optional(v.id('customers')),
    status: v.optional(conversationStatusValidator),
    priority: v.optional(conversationPriorityValidator),
    channel: v.optional(v.string()),
    direction: v.optional(v.union(v.literal('inbound'), v.literal('outbound'))),
    paginationOpts: cursorPaginationOptsValidator,
  },
  returns: v.object({
    page: v.array(internalConversationRecordValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    return await ConversationsHelpers.queryConversations(ctx, args);
  },
});

export const queryConversationMessages = internalQuery({
  args: {
    organizationId: v.string(),
    conversationId: v.optional(v.id('conversations')),
    channel: v.optional(v.string()),
    direction: v.optional(v.union(v.literal('inbound'), v.literal('outbound'))),
    paginationOpts: cursorPaginationOptsValidator,
  },
  returns: v.object({
    page: v.array(internalMessageRecordValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    return await ConversationsHelpers.queryConversationMessages(ctx, args);
  },
});

export const queryLatestMessageByDeliveryState = internalQuery({
  args: {
    organizationId: v.string(),
    channel: v.string(),
    direction: v.union(v.literal('inbound'), v.literal('outbound')),
    deliveryState: v.union(
      v.literal('queued'),
      v.literal('sent'),
      v.literal('delivered'),
      v.literal('failed'),
    ),
    providerId: v.optional(v.id('emailProviders')),
  },
  returns: v.object({
    message: v.union(internalMessageRecordValidator, v.null()),
  }),
  handler: async (ctx, args) => {
    return await ConversationsHelpers.queryLatestMessageByDeliveryState(
      ctx,
      args,
    );
  },
});

// =============================================================================
// PUBLIC QUERIES (with RLS)
// =============================================================================

/**
 * Check if organization has any conversations (fast count query for empty state detection)
 */
export const hasConversations = queryWithRLS({
  args: {
    organizationId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    return await hasRecordsInOrg(ctx.db, 'conversations', args.organizationId);
  },
});

export const getConversation = queryWithRLS({
  args: {
    conversationId: v.id('conversations'),
  },
  returns: v.union(v.null(), internalConversationRecordValidator),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.conversationId);
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

/**
 * List conversations with cursor pagination.
 * Returns fully transformed conversations with customer info and messages.
 */
export const listConversations = queryWithRLS({
  args: {
    organizationId: v.string(),
    status: v.optional(conversationStatusValidator),
    paginationOpts: cursorPaginationOptsValidator,
  },
  returns: v.object({
    page: v.array(conversationItemValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const query = args.status
      ? ctx.db
          .query('conversations')
          .withIndex('by_org_status_lastMessageAt', (q) =>
            q.eq('organizationId', args.organizationId).eq('status', args.status),
          )
          .order('desc')
      : ctx.db
          .query('conversations')
          .withIndex('by_organizationId', (q) =>
            q.eq('organizationId', args.organizationId),
          )
          .order('desc');

    const result = await query.paginate(args.paginationOpts);

    const transformedPage = await Promise.all(
      result.page.map((conversation) =>
        ConversationsHelpers.transformConversation(ctx, conversation, {
          includeAllMessages: false,
        }),
      ),
    );

    return {
      page: transformedPage,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});
