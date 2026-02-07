/**
 * Conversations Mutations
 *
 * All mutation operations for conversations.
 * Business logic is in ./helpers.ts
 */

import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { mutationWithRLS } from '../lib/rls';
import * as ConversationsHelpers from './helpers';
import {
  bulkOperationResultValidator,
  conversationStatusValidator,
  conversationPriorityValidator,
  attachmentValidator,
  messageStatusValidator,
} from './validators';
import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';

// =============================================================================
// INTERNAL MUTATIONS (without RLS)
// =============================================================================

export const createConversation = internalMutation({
  args: {
    organizationId: v.string(),
    customerId: v.optional(v.id('customers')),
    externalMessageId: v.optional(v.string()),
    subject: v.optional(v.string()),
    status: v.optional(conversationStatusValidator),
    priority: v.optional(conversationPriorityValidator),
    type: v.optional(v.string()),
    channel: v.optional(v.string()),
    direction: v.optional(v.union(v.literal('inbound'), v.literal('outbound'))),
    providerId: v.optional(v.id('emailProviders')),
    metadata: v.optional(jsonRecordValidator),
  },
  returns: v.object({
    success: v.boolean(),
    conversationId: v.id('conversations'),
  }),
  handler: async (ctx, args) => {
    return await ConversationsHelpers.createConversation(ctx, args);
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
    priority: v.optional(conversationPriorityValidator),
    type: v.optional(v.string()),
    channel: v.optional(v.string()),
    direction: v.optional(v.union(v.literal('inbound'), v.literal('outbound'))),
    providerId: v.optional(v.id('emailProviders')),
    metadata: v.optional(jsonRecordValidator),

    // Initial message fields
    initialMessage: v.object({
      sender: v.string(),
      content: v.string(),
      isCustomer: v.boolean(),
      status: v.optional(messageStatusValidator),
      attachment: v.optional(attachmentValidator),
      externalMessageId: v.optional(v.string()),
      metadata: v.optional(jsonRecordValidator),
      sentAt: v.optional(v.number()),
      deliveredAt: v.optional(v.number()),
    }),
  },
  returns: v.object({
    success: v.boolean(),
    conversationId: v.id('conversations'),
    messageId: v.id('conversationMessages'),
  }),
  handler: async (ctx, args) => {
    return await ConversationsHelpers.createConversationWithMessage(ctx, args);
  },
});

export const updateConversations = internalMutation({
  args: {
    conversationId: v.optional(v.id('conversations')),
    organizationId: v.optional(v.string()),
    status: v.optional(conversationStatusValidator),
    priority: v.optional(conversationPriorityValidator),

    updates: v.object({
      customerId: v.optional(v.id('customers')),
      subject: v.optional(v.string()),
      status: v.optional(conversationStatusValidator),
      priority: v.optional(conversationPriorityValidator),
      type: v.optional(v.string()),
      metadata: v.optional(jsonRecordValidator),
    }),
  },
  returns: v.object({
    success: v.boolean(),
    updatedCount: v.number(),
    updatedIds: v.array(v.id('conversations')),
  }),
  handler: async (ctx, args) => {
    return await ConversationsHelpers.updateConversations(ctx, args);
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
    attachment: v.optional(attachmentValidator),
    providerId: v.optional(v.id('emailProviders')),
    externalMessageId: v.optional(v.string()),
    metadata: v.optional(jsonRecordValidator),
    sentAt: v.optional(v.number()),
    deliveredAt: v.optional(v.number()),
  },
  returns: v.id('conversations'),
  handler: async (ctx, args) => {
    return await ConversationsHelpers.addMessageToConversation(ctx, args);
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
    metadata: v.optional(jsonRecordValidator),
    retryCount: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ConversationsHelpers.updateConversationMessage(ctx, args);
    return null;
  },
});

/**
 * Backfill lastMessageAt for conversations that don't have it set.
 * This migration should be run once after deploying the schema change.
 * It processes conversations in batches to avoid timeout.
 *
 * Usage: Run via Convex dashboard or CLI:
 * npx convex run conversations:backfillLastMessageAt
 */
export const backfillLastMessageAt = internalMutation({
  args: {
    batchSize: v.optional(v.number()),
    cursor: v.optional(v.id('conversations')),
  },
  returns: v.object({
    processed: v.number(),
    nextCursor: v.union(v.id('conversations'), v.null()),
    done: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 100;

    // Query conversations, optionally starting from cursor
    const conversations = args.cursor
      ? await ctx.db
          .query('conversations')
          .filter((q) => q.gt(q.field('_id'), args.cursor!))
          .take(batchSize)
      : await ctx.db.query('conversations').take(batchSize);

    let processed = 0;
    let lastId: string | null = null;

    for (const conv of conversations) {
      lastId = conv._id;

      // Skip if already has lastMessageAt
      if (conv.lastMessageAt !== undefined) {
        continue;
      }

      // Find the latest message for this conversation
      const latestMessage = await ctx.db
        .query('conversationMessages')
        .withIndex('by_conversationId_and_deliveredAt', (q) =>
          q.eq('conversationId', conv._id),
        )
        .order('desc')
        .first();

      // Determine lastMessageAt from messages or fallback to creation time
      let lastMessageAt: number;
      if (latestMessage) {
        // Use deliveredAt, sentAt, or _creationTime
        lastMessageAt =
          latestMessage.deliveredAt ??
          latestMessage.sentAt ??
          latestMessage._creationTime;
      } else {
        // No messages - use conversation creation time
        lastMessageAt = conv._creationTime;
      }

      // Update the conversation
      await ctx.db.patch(conv._id, { lastMessageAt });
      processed++;
    }

    return {
      processed,
      nextCursor: lastId as Id<'conversations'> | null,
      done: conversations.length < batchSize,
    };
  },
});

// =============================================================================
// PUBLIC MUTATIONS (with RLS)
// =============================================================================

export const updateConversation = mutationWithRLS({
  args: {
    conversationId: v.id('conversations'),
    subject: v.optional(v.string()),
    status: v.optional(conversationStatusValidator),
    priority: v.optional(conversationPriorityValidator),
    type: v.optional(v.string()),
    metadata: v.optional(jsonRecordValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ConversationsHelpers.updateConversation(ctx, args);
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
    attachment: v.optional(attachmentValidator),
    providerId: v.optional(v.id('emailProviders')),
    externalMessageId: v.optional(v.string()),
  },
  returns: v.id('conversations'),
  handler: async (ctx, args) => {
    return await ConversationsHelpers.addMessageToConversation(ctx, args);
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
    return await ConversationsHelpers.sendMessageViaEmail(ctx, args);
  },
});

export const closeConversation = mutationWithRLS({
  args: {
    conversationId: v.id('conversations'),
    resolvedBy: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ConversationsHelpers.closeConversation(ctx, args);
    return null;
  },
});

export const reopenConversation = mutationWithRLS({
  args: {
    conversationId: v.id('conversations'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ConversationsHelpers.reopenConversation(ctx, args);
    return null;
  },
});

export const markConversationAsSpam = mutationWithRLS({
  args: {
    conversationId: v.id('conversations'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ConversationsHelpers.markConversationAsSpam(ctx, args);
    return null;
  },
});

export const markConversationAsRead = mutationWithRLS({
  args: {
    conversationId: v.id('conversations'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ConversationsHelpers.markConversationAsRead(ctx, args);
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
    return await ConversationsHelpers.bulkCloseConversations(ctx, args);
  },
});

export const bulkReopenConversations = mutationWithRLS({
  args: {
    conversationIds: v.array(v.id('conversations')),
  },
  returns: bulkOperationResultValidator,
  handler: async (ctx, args) => {
    return await ConversationsHelpers.bulkReopenConversations(ctx, args);
  },
});
