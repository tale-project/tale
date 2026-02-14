import { v } from 'convex/values';

import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';
import { internalQuery } from '../_generated/server';
import { cursorPaginationOptsValidator } from '../lib/pagination';
import * as ConversationsHelpers from './helpers';
import {
  conversationStatusValidator,
  conversationPriorityValidator,
} from './validators';

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
  direction: v.optional(v.union(v.literal('inbound'), v.literal('outbound'))),
  lastMessageAt: v.optional(v.number()),
  metadata: v.optional(jsonRecordValidator),
});

const internalMessageRecordValidator = v.object({
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
});

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

export const getMessageById = internalQuery({
  args: {
    messageId: v.id('conversationMessages'),
    organizationId: v.string(),
  },
  returns: v.union(internalMessageRecordValidator, v.null()),
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message || message.organizationId !== args.organizationId) {
      return null;
    }
    return message;
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
