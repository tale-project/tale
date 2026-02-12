import { v, type Infer } from 'convex/values';

import type { Id } from '../_generated/dataModel';

import { api } from '../_generated/api';
import { action } from '../_generated/server';
import { authComponent } from '../auth';
import { improveMessage as improveMessageHandler } from './improve_message';
import {
  attachmentValidator,
  bulkOperationResultValidator,
} from './validators';

export const improveMessage = action({
  args: {
    originalMessage: v.string(),
    instruction: v.optional(v.string()),
  },
  returns: v.object({
    improvedMessage: v.string(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    return improveMessageHandler(ctx, args);
  },
});

export const addMessageToConversation = action({
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
  handler: async (ctx, args): Promise<Id<'conversations'>> => {
    return await ctx.runMutation(
      api.conversations.mutations.addMessageToConversation,
      args,
    );
  },
});

export const bulkCloseConversations = action({
  args: {
    conversationIds: v.array(v.id('conversations')),
    resolvedBy: v.optional(v.string()),
  },
  returns: bulkOperationResultValidator,
  handler: async (
    ctx,
    args,
  ): Promise<Infer<typeof bulkOperationResultValidator>> => {
    return await ctx.runMutation(
      api.conversations.mutations.bulkCloseConversations,
      args,
    );
  },
});

export const bulkReopenConversations = action({
  args: {
    conversationIds: v.array(v.id('conversations')),
  },
  returns: bulkOperationResultValidator,
  handler: async (
    ctx,
    args,
  ): Promise<Infer<typeof bulkOperationResultValidator>> => {
    return await ctx.runMutation(
      api.conversations.mutations.bulkReopenConversations,
      args,
    );
  },
});

export const sendMessageViaEmail = action({
  args: {
    conversationId: v.id('conversations'),
    organizationId: v.string(),
    content: v.string(),
    providerId: v.optional(v.id('emailProviders')),
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
  handler: async (ctx, args): Promise<Id<'conversationMessages'>> => {
    return await ctx.runMutation(
      api.conversations.mutations.sendMessageViaEmail,
      args,
    );
  },
});
