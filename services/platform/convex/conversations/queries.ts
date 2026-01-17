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
import * as ConversationsHelpers from './helpers';
import {
  conversationWithMessagesValidator,
  conversationStatusValidator,
  conversationPriorityValidator,
  conversationDocValidator,
} from './validators';
import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';

// =============================================================================
// INTERNAL QUERIES (without RLS)
// =============================================================================

export const getConversationById = internalQuery({
  args: {
    conversationId: v.id('conversations'),
  },
  returns: v.union(
    v.object({
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
    }),
    v.null(),
  ),
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
  returns: v.union(
    v.object({
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
    }),
    v.null(),
  ),
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
  returns: v.union(
    v.object({
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
    }),
    v.null(),
  ),
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
    page: v.array(
      v.object({
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
      }),
    ),
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
    page: v.array(
      v.object({
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
      }),
    ),
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
    message: v.union(
      v.object({
        _id: v.id('conversationMessages'),
        _creationTime: v.number(),
        organizationId: v.string(),
        conversationId: v.id('conversations'),
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
      }),
      v.null(),
    ),
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
    const firstConversation = await ctx.db
      .query('conversations')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .first();
    return firstConversation !== null;
  },
});

export const getConversation = queryWithRLS({
  args: {
    conversationId: v.id('conversations'),
  },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id('conversations'),
      _creationTime: v.number(),
      organizationId: v.string(),
      customerId: v.optional(v.id('customers')),
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
    }),
  ),
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
 * Get all conversations for an organization without pagination or filtering.
 * Filtering, sorting, and pagination are performed client-side using TanStack DB Collections.
 */
export const getAllConversations = queryWithRLS({
  args: {
    organizationId: v.string(),
  },
  returns: v.array(conversationDocValidator),
  handler: async (ctx, args) => {
    const conversations = [];
    for await (const conversation of ctx.db
      .query('conversations')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      conversations.push(conversation);
    }
    return conversations;
  },
});
