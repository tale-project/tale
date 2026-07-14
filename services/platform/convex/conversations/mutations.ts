import { ConvexError, v } from 'convex/values';

import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { mutationWithRLS } from '../lib/rls';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { composeEmailConversation as composeEmailConversationHelper } from './compose_email_conversation';
import * as ConversationsHelpers from './helpers';
import {
  bulkReplyToConversations as bulkReplyToConversationsHelper,
  replyToConversation as replyToConversationHelper,
} from './reply_to_conversation';
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
          storageId: v.id('_storage'),
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

export const replyToConversation = mutationWithRLS({
  args: {
    conversationId: v.id('conversations'),
    organizationId: v.string(),
    content: v.string(),
    attachments: v.optional(
      v.array(
        v.object({
          storageId: v.id('_storage'),
          fileName: v.string(),
          contentType: v.string(),
          size: v.number(),
        }),
      ),
    ),
  },
  returns: v.id('conversationMessages'),
  handler: async (ctx, args) => {
    return await replyToConversationHelper(ctx, args);
  },
});

export const composeEmailConversation = mutationWithRLS({
  args: {
    organizationId: v.string(),
    contactId: v.id('contacts'),
    integrationName: v.string(),
    subject: v.string(),
    content: v.string(),
    from: v.optional(v.string()),
    attachments: v.optional(
      v.array(
        v.object({
          storageId: v.id('_storage'),
          fileName: v.string(),
          contentType: v.string(),
          size: v.number(),
        }),
      ),
    ),
  },
  returns: v.object({
    conversationId: v.id('conversations'),
    messageId: v.id('conversationMessages'),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    conversationId: Id<'conversations'>;
    messageId: Id<'conversationMessages'>;
  }> => {
    // Default-assign a NON-ADMIN starter as the owner; admin/owner-started
    // threads stay unassigned (→ admin fallback until an admin assigns).
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new ConvexError({ code: 'UNAUTHENTICATED' });
    // Resolve the starter's role from the member mirror via an internal query —
    // this RLS-wrapped ctx can't read `memberMirror` directly (it's filtered),
    // so the read runs on a raw ctx. A non-admin starter becomes the default
    // owner; owner/admin-started threads stay unassigned (→ admin fallback until
    // an admin assigns). Unknown role ⇒ treat as non-admin (assign the starter).
    const role = await ctx.runQuery(
      internal.members.internal_queries.getMirrorMemberRole,
      { organizationId: args.organizationId, userId: authUser.userId },
    );
    const isAdmin = role === 'owner' || role === 'admin';
    return await composeEmailConversationHelper(ctx, {
      ...args,
      assigneeUserId: isAdmin ? undefined : authUser.userId,
    });
  },
});

export const bulkReplyToConversations = mutationWithRLS({
  args: {
    conversationIds: v.array(v.id('conversations')),
    organizationId: v.string(),
    content: v.string(),
  },
  returns: bulkOperationResultValidator,
  handler: async (ctx, args) => {
    return await bulkReplyToConversationsHelper(ctx, args);
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

export const bulkArchiveConversations = mutationWithRLS({
  args: {
    conversationIds: v.array(v.id('conversations')),
  },
  returns: bulkOperationResultValidator,
  handler: async (ctx, args) => {
    return await ConversationsHelpers.bulkArchiveConversations(ctx, args);
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

export const bulkSpamConversations = mutationWithRLS({
  args: {
    conversationIds: v.array(v.id('conversations')),
  },
  returns: bulkOperationResultValidator,
  handler: async (ctx, args) => {
    return await ConversationsHelpers.bulkSpamConversations(ctx, args);
  },
});

export const bulkUnarchiveConversations = mutationWithRLS({
  args: {
    conversationIds: v.array(v.id('conversations')),
  },
  returns: bulkOperationResultValidator,
  handler: async (ctx, args) => {
    return await ConversationsHelpers.bulkUnarchiveConversations(ctx, args);
  },
});

export const deleteConversation = mutationWithRLS({
  args: {
    conversationId: v.id('conversations'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ConversationsHelpers.deleteConversation(ctx, args.conversationId);
    return null;
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
      throw new ConvexError({
        code: 'message_not_found',
        message: 'Message not found',
      });
    }

    const conversation = await ctx.db.get(message.conversationId);
    if (!conversation) {
      throw new ConvexError({
        code: 'conversation_not_found',
        message: 'Conversation not found',
      });
    }

    if (!message.externalMessageId) {
      throw new ConvexError({
        code: 'message_no_external_id',
        message: 'Message has no external ID for attachment download',
      });
    }

    const integrationName = conversation.integrationName;
    if (!integrationName) {
      // Fail closed rather than silently routing through Outlook — a Gmail/IMAP
      // (or unstamped) conversation would otherwise dispatch to the wrong
      // provider. Mirrors `reply_to_conversation`'s no-silent-fallback rule.
      throw new ConvexError({
        code: 'conversation_integration_missing',
        message:
          'Conversation has no integration to download attachments through — unavailable until a sync stamps its integrationName',
      });
    }

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
