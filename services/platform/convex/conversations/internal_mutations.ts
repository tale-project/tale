import { v } from 'convex/values';

import type { Id } from '../_generated/dataModel';

import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';
import { internalMutation } from '../_generated/server';
import * as ConversationsHelpers from './helpers';
import {
  conversationStatusValidator,
  conversationPriorityValidator,
  attachmentValidator,
  messageStatusValidator,
} from './validators';

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
    metadata: v.optional(jsonRecordValidator),

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

export const addMessageToConversation = internalMutation({
  args: {
    conversationId: v.id('conversations'),
    organizationId: v.string(),
    sender: v.string(),
    content: v.string(),
    isCustomer: v.boolean(),
    status: v.optional(v.string()),
    attachment: v.optional(attachmentValidator),
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

export const updateConversationMessage = internalMutation({
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

    const cursor = args.cursor;
    const conversations = cursor
      ? await ctx.db
          .query('conversations')
          .filter((q) => q.gt(q.field('_id'), cursor))
          .take(batchSize)
      : await ctx.db.query('conversations').take(batchSize);

    let processed = 0;
    let lastId: Id<'conversations'> | null = null;

    for (const conv of conversations) {
      lastId = conv._id;

      if (conv.lastMessageAt !== undefined) {
        continue;
      }

      const latestMessage = await ctx.db
        .query('conversationMessages')
        .withIndex('by_conversationId_and_deliveredAt', (q) =>
          q.eq('conversationId', conv._id),
        )
        .order('desc')
        .first();

      let lastMessageAt: number;
      if (latestMessage) {
        lastMessageAt =
          latestMessage.deliveredAt ??
          latestMessage.sentAt ??
          latestMessage._creationTime;
      } else {
        lastMessageAt = conv._creationTime;
      }

      await ctx.db.patch(conv._id, { lastMessageAt });
      processed++;
    }

    return {
      processed,
      nextCursor: lastId,
      done: conversations.length < batchSize,
    };
  },
});
