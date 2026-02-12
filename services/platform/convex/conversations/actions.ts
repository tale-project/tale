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
