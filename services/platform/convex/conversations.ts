/**
 * Conversations API - Thin wrappers for conversation operations
 *
 * This file contains all public and internal Convex functions for conversations.
 * Business logic is in convex/model/conversations/
 */

import { v } from 'convex/values';
import { internalQuery, internalMutation } from './_generated/server';
import { queryWithRLS, mutationWithRLS } from './lib/rls';

// Import model functions and validators
import * as ConversationsModel from './model/conversations';
import { queryConversationMessages as queryConversationMessagesModel } from './model/conversations/query_conversation_messages';
import {
  conversationListResponseValidator,
  conversationWithMessagesValidator,
  bulkOperationResultValidator,
  conversationStatusValidator,
} from './model/conversations/types';

// =============================================================================
// INTERNAL OPERATIONS (without RLS)
// =============================================================================

export const createConversation = internalMutation({
  args: {
    organizationId: v.string(),
    customerId: v.optional(v.id('customers')),
    externalMessageId: v.optional(v.string()),
    subject: v.optional(v.string()),
    status: v.optional(conversationStatusValidator),
    priority: v.optional(v.string()),
    type: v.optional(v.string()),
    channel: v.optional(v.string()),
    direction: v.optional(v.union(v.literal('inbound'), v.literal('outbound'))),
    providerId: v.optional(v.id('emailProviders')),

    metadata: v.optional(v.any()),
  },
  returns: v.object({
    success: v.boolean(),
    conversationId: v.id('conversations'),
  }),
  handler: async (ctx, args) => {
    return await ConversationsModel.createConversation(ctx, args);
  },
});

/**
 * Create a conversation with an initial message (internal)
 */
export const createConversationWithMessage = internalMutation({
  args: {
    organizationId: v.string(),
    customerId: v.optional(v.id('customers')),
    externalMessageId: v.optional(v.string()),
    subject: v.optional(v.string()),
    status: v.optional(conversationStatusValidator),
    priority: v.optional(v.string()),
    type: v.optional(v.string()),
    channel: v.optional(v.string()),
    direction: v.optional(v.union(v.literal('inbound'), v.literal('outbound'))),
    providerId: v.optional(v.id('emailProviders')),
    metadata: v.optional(v.any()),

    // Initial message fields
    initialMessage: v.object({
      sender: v.string(),
      content: v.string(),
      isCustomer: v.boolean(),
      status: v.optional(v.string()),
      attachment: v.optional(v.any()),
      externalMessageId: v.optional(v.string()),
      metadata: v.optional(v.any()),
      sentAt: v.optional(v.number()), // Timestamp when message was sent (for outbound) or received (for inbound)
      deliveredAt: v.optional(v.number()), // Timestamp when message was delivered (for email sync)
    }),
  },
  returns: v.object({
    success: v.boolean(),
    conversationId: v.id('conversations'),
    messageId: v.id('conversationMessages'),
  }),
  handler: async (ctx, args) => {
    return await ConversationsModel.createConversationWithMessage(ctx, args);
  },
});

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
      status: v.optional(v.string()),
      priority: v.optional(v.string()),
      type: v.optional(v.string()),
      channel: v.optional(v.string()),
      direction: v.optional(
        v.union(v.literal('inbound'), v.literal('outbound')),
      ),
      providerId: v.optional(v.id('emailProviders')),

      metadata: v.optional(v.any()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    return await ConversationsModel.getConversationById(
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
      status: v.optional(v.string()),
      priority: v.optional(v.string()),
      type: v.optional(v.string()),
      channel: v.optional(v.string()),
      direction: v.optional(
        v.union(v.literal('inbound'), v.literal('outbound')),
      ),
      providerId: v.optional(v.id('emailProviders')),

      metadata: v.optional(v.any()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    return await ConversationsModel.getConversationByExternalMessageId(
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
      metadata: v.optional(v.any()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    return await ConversationsModel.getMessageByExternalId(
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
    priority: v.optional(v.string()),
    channel: v.optional(v.string()),
    direction: v.optional(v.union(v.literal('inbound'), v.literal('outbound'))),

    paginationOpts: v.object({
      numItems: v.number(),
      cursor: v.union(v.string(), v.null()),
    }),
  },
  returns: v.object({
    items: v.array(
      v.object({
        _id: v.id('conversations'),
        _creationTime: v.number(),
        organizationId: v.string(),
        customerId: v.optional(v.id('customers')),
        externalMessageId: v.optional(v.string()),
        subject: v.optional(v.string()),
        status: v.optional(v.string()),
        priority: v.optional(v.string()),
        type: v.optional(v.string()),
        channel: v.optional(v.string()),
        direction: v.optional(
          v.union(v.literal('inbound'), v.literal('outbound')),
        ),
        providerId: v.optional(v.id('emailProviders')),

        metadata: v.optional(v.any()),
      }),
    ),
    isDone: v.boolean(),
    continueCursor: v.union(v.string(), v.null()),
    count: v.number(),
  }),
  handler: async (ctx, args) => {
    return await ConversationsModel.queryConversations(ctx, args);
  },
});

export const queryConversationMessages = internalQuery({
  args: {
    organizationId: v.string(),
    conversationId: v.optional(v.id('conversations')),
    channel: v.optional(v.string()),
    direction: v.optional(v.union(v.literal('inbound'), v.literal('outbound'))),
    paginationOpts: v.object({
      numItems: v.number(),
      cursor: v.union(v.string(), v.null()),
    }),
  },
  returns: v.object({
    items: v.array(
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
        metadata: v.optional(v.any()),
      }),
    ),
    isDone: v.boolean(),
    continueCursor: v.union(v.string(), v.null()),
    count: v.number(),
  }),
  handler: async (ctx, args) => {
    return await queryConversationMessagesModel(ctx, args);
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
        metadata: v.optional(v.any()),
      }),
      v.null(),
    ),
  }),
  handler: async (ctx, args) => {
    return await ConversationsModel.queryLatestMessageByDeliveryState(
      ctx,
      args,
    );
  },
});

export const updateConversations = internalMutation({
  args: {
    conversationId: v.optional(v.id('conversations')),
    organizationId: v.optional(v.string()),
    status: v.optional(conversationStatusValidator),
    priority: v.optional(v.string()),

    updates: v.object({
      customerId: v.optional(v.id('customers')),
      subject: v.optional(v.string()),
      status: v.optional(conversationStatusValidator),
      priority: v.optional(v.string()),
      type: v.optional(v.string()),

      metadata: v.optional(v.record(v.string(), v.any())),
    }),
  },
  returns: v.object({
    success: v.boolean(),
    updatedCount: v.number(),
    updatedIds: v.array(v.id('conversations')),
  }),
  handler: async (ctx, args) => {
    return await ConversationsModel.updateConversations(ctx, args);
  },
});

export const addMessageToConversationInternal = internalMutation({
  args: {
    conversationId: v.id('conversations'),
    organizationId: v.string(),
    sender: v.string(),
    content: v.string(),
    isCustomer: v.boolean(),
    status: v.optional(v.string()),
    attachment: v.optional(v.any()),
    providerId: v.optional(v.id('emailProviders')), // Email provider ID (stored on conversation, not message)
    externalMessageId: v.optional(v.string()),
    metadata: v.optional(v.any()),
    sentAt: v.optional(v.number()), // Timestamp when message was sent (for outbound) or received (for inbound)
    deliveredAt: v.optional(v.number()), // Timestamp when message was delivered (for email sync)
  },
  returns: v.id('conversations'),
  handler: async (ctx, args) => {
    return await ConversationsModel.addMessageToConversation(ctx, args);
  },
});

export const updateConversationMessageInternal = internalMutation({
  args: {
    messageId: v.id('conversationMessages'),
    externalMessageId: v.optional(v.string()),
    deliveryState: v.optional(
      v.union(
        v.literal('queued'),
        v.literal('sent'),
        v.literal('delivered'),
        v.literal('failed'),
      ),
    ),
    sentAt: v.optional(v.number()),
    deliveredAt: v.optional(v.number()),
    metadata: v.optional(v.any()),
    retryCount: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ConversationsModel.updateConversationMessage(ctx, args);
    return null;
  },
});

// =============================================================================
// PUBLIC OPERATIONS (with RLS)
// =============================================================================

export const getConversations = queryWithRLS({
  args: {
    organizationId: v.string(),
    status: v.optional(conversationStatusValidator),
    priority: v.optional(v.string()),
    search: v.optional(v.string()),
    page: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  returns: conversationListResponseValidator,
  handler: async (ctx, args) => {
    return await ConversationsModel.getConversations(ctx, args);
  },
});

export const getConversationsPage = queryWithRLS({
  args: {
    organizationId: v.string(),
    status: v.optional(conversationStatusValidator),
    priority: v.optional(v.string()),
    category: v.optional(v.string()),
    search: v.optional(v.string()),
    page: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  returns: conversationListResponseValidator,
  handler: async (ctx, args) => {
    return await ConversationsModel.getConversationsPage(ctx, args);
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
      status: v.optional(v.string()),
      priority: v.optional(v.string()),
      type: v.optional(v.string()),
      channel: v.optional(v.string()),
      direction: v.optional(
        v.union(v.literal('inbound'), v.literal('outbound')),
      ),
      providerId: v.optional(v.id('emailProviders')),

      metadata: v.optional(v.any()),
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
    return await ConversationsModel.getConversationWithMessages(
      ctx,
      args.conversationId,
    );
  },
});

export const updateConversation = mutationWithRLS({
  args: {
    conversationId: v.id('conversations'),
    subject: v.optional(v.string()),
    status: v.optional(conversationStatusValidator),
    priority: v.optional(v.string()),
    type: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ConversationsModel.updateConversation(ctx, args);
    return null;
  },
});

export const addMessageToConversation = mutationWithRLS({
  args: {
    conversationId: v.id('conversations'),
    organizationId: v.string(),
    sender: v.string(),
    content: v.string(),
    isCustomer: v.boolean(),
    status: v.optional(v.string()),
    attachment: v.optional(v.any()),
    providerId: v.optional(v.id('emailProviders')), // Email provider ID (stored on conversation, not message)
    externalMessageId: v.optional(v.string()),
  },
  returns: v.id('conversations'),
  handler: async (ctx, args) => {
    return await ConversationsModel.addMessageToConversation(ctx, args);
  },
});

/**
 * Send a message via email (SMTP)
 * Creates a conversation message with 'queued' status and schedules SMTP send
 * Automatically approves any pending approval for this conversation
 */
export const sendMessageViaEmail = mutationWithRLS({
  args: {
    conversationId: v.id('conversations'),
    organizationId: v.string(),
    content: v.string(),
    providerId: v.optional(v.id('emailProviders')),
    // Email-specific fields
    to: v.array(v.string()),
    cc: v.optional(v.array(v.string())),
    bcc: v.optional(v.array(v.string())),
    subject: v.string(),
    html: v.optional(v.string()),
    text: v.optional(v.string()),
    replyTo: v.optional(v.string()),
    inReplyTo: v.optional(v.string()),
    references: v.optional(v.array(v.string())),
    headers: v.optional(v.record(v.string(), v.string())),
    attachments: v.optional(
      v.array(
        v.object({
          storageId: v.string(),
          name: v.string(),
          size: v.number(),
          type: v.string(),
          contentType: v.string(),
        }),
      ),
    ),
  },
  returns: v.id('conversationMessages'),
  handler: async (ctx, args) => {
    return await ConversationsModel.sendMessageViaEmail(ctx, args);
  },
});

export const closeConversation = mutationWithRLS({
  args: {
    conversationId: v.id('conversations'),
    resolvedBy: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ConversationsModel.closeConversation(ctx, args);
    return null;
  },
});

export const reopenConversation = mutationWithRLS({
  args: {
    conversationId: v.id('conversations'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ConversationsModel.reopenConversation(ctx, args.conversationId);
    return null;
  },
});

export const markConversationAsSpam = mutationWithRLS({
  args: {
    conversationId: v.id('conversations'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ConversationsModel.markConversationAsSpam(ctx, args.conversationId);
    return null;
  },
});

export const markConversationAsRead = mutationWithRLS({
  args: {
    conversationId: v.id('conversations'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ConversationsModel.markConversationAsRead(ctx, args.conversationId);
    return null;
  },
});

export const bulkCloseConversations = mutationWithRLS({
  args: {
    conversationIds: v.array(v.id('conversations')),
    resolvedBy: v.optional(v.string()),
  },
  returns: bulkOperationResultValidator,
  handler: async (ctx, args) => {
    return await ConversationsModel.bulkCloseConversations(ctx, args);
  },
});

export const bulkReopenConversations = mutationWithRLS({
  args: {
    conversationIds: v.array(v.id('conversations')),
  },
  returns: bulkOperationResultValidator,
  handler: async (ctx, args) => {
    return await ConversationsModel.bulkReopenConversations(
      ctx,
      args.conversationIds,
    );
  },
});
