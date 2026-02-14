import { v } from 'convex/values';

import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';
import { internal } from '../_generated/api';
import { mutationWithRLS } from '../lib/rls';
import * as ConversationsHelpers from './helpers';
import {
  bulkOperationResultValidator,
  conversationStatusValidator,
  conversationPriorityValidator,
  attachmentValidator,
} from './validators';

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
    externalMessageId: v.optional(v.string()),
  },
  returns: v.id('conversations'),
  handler: async (ctx, args) => {
    return await ConversationsHelpers.addMessageToConversation(ctx, args);
  },
});

export const sendMessageViaIntegration = mutationWithRLS({
  args: {
    conversationId: v.id('conversations'),
    organizationId: v.string(),
    integrationName: v.string(),
    content: v.string(),
    to: v.array(v.string()),
    cc: v.optional(v.array(v.string())),
    subject: v.string(),
    html: v.optional(v.string()),
    text: v.optional(v.string()),
    inReplyTo: v.optional(v.string()),
    references: v.optional(v.array(v.string())),
    attachments: v.optional(
      v.array(
        v.object({
          storageId: v.string(),
          fileName: v.string(),
          contentType: v.string(),
          size: v.number(),
        }),
      ),
    ),
  },
  returns: v.id('conversationMessages'),
  handler: async (ctx, args) => {
    return await ConversationsHelpers.sendMessageViaIntegration(ctx, args);
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

export const downloadAttachments = mutationWithRLS({
  args: {
    messageId: v.id('conversationMessages'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message) {
      throw new Error('Message not found');
    }

    const conversation = await ctx.db.get(message.conversationId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }

    if (!message.externalMessageId) {
      throw new Error('Message has no external ID for attachment download');
    }

    const integrationName =
      typeof conversation.metadata?.integrationName === 'string'
        ? conversation.metadata.integrationName
        : 'outlook';

    await ctx.scheduler.runAfter(
      0,
      internal.conversations.internal_actions.downloadAttachmentsAction,
      {
        messageId: args.messageId,
        organizationId: conversation.organizationId,
        integrationName,
        externalMessageId: message.externalMessageId,
      },
    );

    return null;
  },
});
