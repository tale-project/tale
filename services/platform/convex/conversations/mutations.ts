import { ConvexError, v } from 'convex/values';

import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { emitAuditSuccess } from '../audit_logs/emit';
import { buildAuditContext } from '../lib/helpers/build_audit_context';
import { mutationWithRLS } from '../lib/rls';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { composeEmailConversation as composeEmailConversationHelper } from './compose_email_conversation';
import { discardOutboundMessage as discardOutboundMessageHelper } from './discard_outbound_message';
import * as ConversationsHelpers from './helpers';
import {
  bulkReplyToConversations as bulkReplyToConversationsHelper,
  replyToConversation as replyToConversationHelper,
} from './reply_to_conversation';
import { retrySendMessage as retrySendMessageHelper } from './retry_send_message';
import { undoSendMessage as undoSendMessageHelper } from './undo_send_message';
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

export const sendMessageViaConnector = mutationWithRLS({
  args: {
    conversationId: v.id('conversations'),
    organizationId: v.string(),
    connectorName: v.string(),
    content: v.string(),
    to: v.array(v.string()),
    cc: v.optional(v.array(v.string())),
    subject: v.string(),
    html: v.optional(v.string()),
    text: v.optional(v.string()),
    inReplyTo: v.optional(v.string()),
    references: v.optional(v.array(v.string())),
    // Composer draft (markdown) at send time — stored in message metadata for
    // undo-send draft restore, never part of the outbound email.
    sourceMarkdown: v.optional(v.string()),
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
    return await ConversationsHelpers.sendMessageViaConnector(ctx, args);
  },
});

export const replyToConversation = mutationWithRLS({
  args: {
    conversationId: v.id('conversations'),
    organizationId: v.string(),
    content: v.string(),
    sourceMarkdown: v.optional(v.string()),
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
    connectorName: v.string(),
    subject: v.string(),
    content: v.string(),
    sourceMarkdown: v.optional(v.string()),
    from: v.optional(v.string()),
    // Chosen assignee (Better Auth userId). Defaults to the creator; only an
    // admin may set a different member — a non-admin pick is clamped to self.
    assigneeUserId: v.optional(v.string()),
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
    // The new conversation is assigned on creation — to the creator by default,
    // or to another member only when an admin picks one.
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new ConvexError({ code: 'UNAUTHENTICATED' });
    // Resolve the starter's role from the member mirror via an internal query —
    // this RLS-wrapped ctx can't read `memberMirror` directly (it's filtered),
    // so the read runs on a raw ctx. Unknown role ⇒ treat as non-admin.
    const role = await ctx.runQuery(
      internal.members.internal_queries.getMirrorMemberRole,
      { organizationId: args.organizationId, userId: authUser.userId },
    );
    const isAdmin = role === 'owner' || role === 'admin';
    // Only an admin may hand the thread to a different member; a non-admin is
    // always the assignee (matches the admin-only reassignment rule).
    const assigneeUserId = isAdmin
      ? args.assigneeUserId || authUser.userId
      : authUser.userId;
    return await composeEmailConversationHelper(ctx, {
      ...args,
      assigneeUserId,
    });
  },
});

/**
 * Set / change / clear a conversation's assignee. **Admin-only** (owner/admin);
 * a non-admin caller is rejected. The new assignee is notified (in-app + email)
 * unless they assigned it to themselves. Unassigning (omit `assigneeUserId`)
 * clears the field and notifies no one. A no-op when the assignee is unchanged.
 *
 * The explicit `Promise<null>` handler return type is required: without it, the
 * `ctx.runQuery(internal.*)` below cycles `ApiFromModules` into a TS7022 cascade
 * (see composeEmailConversation above).
 */
export const assignConversation = mutationWithRLS({
  args: {
    conversationId: v.id('conversations'),
    // Omit ⇒ unassign. A human member userId only — conversations have no agent owners.
    assigneeUserId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new ConvexError({ code: 'UNAUTHENTICATED' });
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) {
      throw new ConvexError({
        code: 'conversation_not_found',
        message: 'Conversation not found',
      });
    }
    // Admin gate — resolve the caller's role from the member mirror on a raw ctx
    // (this RLS ctx can't read `memberMirror`), mirroring composeEmailConversation.
    const role = await ctx.runQuery(
      internal.members.internal_queries.getMirrorMemberRole,
      { organizationId: conversation.organizationId, userId: authUser.userId },
    );
    if (role !== 'owner' && role !== 'admin') {
      throw new ConvexError({
        code: 'FORBIDDEN',
        message: 'Only admins can assign conversations',
      });
    }

    const previousAssigneeUserId = conversation.assigneeUserId ?? null;
    const nextAssigneeUserId = args.assigneeUserId ?? null;
    // Unchanged ⇒ no write, no audit, no notify.
    if (previousAssigneeUserId === nextAssigneeUserId) return null;

    await ctx.db.patch(args.conversationId, {
      assigneeUserId: nextAssigneeUserId ?? undefined,
    });

    // Audit via emitAuditSuccess — it routes the write through the internal
    // createAuditLog on a raw ctx (atomically), because the audit-chain genesis
    // sentinel is deny-all under RLS (#1972); the conversation domain audits
    // this way (reopen/spam/etc.).
    await emitAuditSuccess(ctx, {
      auditCtx: await buildAuditContext(ctx, conversation.organizationId),
      action: nextAssigneeUserId
        ? 'assign_conversation'
        : 'unassign_conversation',
      category: 'data',
      resourceType: 'conversation',
      resourceId: String(args.conversationId),
      resourceName: conversation.subject,
      previousState: { assigneeUserId: previousAssigneeUserId },
      newState: { assigneeUserId: nextAssigneeUserId },
    });

    // Notify the new assignee on a raw ctx (a cross-user userNotifications write
    // isn't allowed under RLS). Skip on unassign and on self-assignment (the
    // emitter self-skips too, but there's no point scheduling a no-op job).
    if (nextAssigneeUserId && nextAssigneeUserId !== authUser.userId) {
      await ctx.scheduler.runAfter(
        0,
        internal.conversations.internal_mutations.notifyAssigned,
        {
          conversationId: args.conversationId,
          assigneeUserId: nextAssigneeUserId,
          actorUserId: authUser.userId,
        },
      );
    }
    return null;
  },
});

/**
 * Set / change / clear the **team** a conversation is queued to. The team
 * dimension is parallel to (and independent of) {@link assignConversation}'s
 * individual owner — both may be set. **Admin-only** (owner/admin); a non-admin
 * caller is rejected. The team's members (except the actor) are notified
 * in-app. Un-queueing (omit `assigneeTeamId`) clears the field and notifies no
 * one. A no-op when the team is unchanged.
 *
 * The explicit `Promise<null>` handler return type is required for the same
 * reason as {@link assignConversation}: the `ctx.runQuery(internal.*)` calls
 * below otherwise cycle `ApiFromModules` into a TS7022 cascade.
 */
export const assignConversationTeam = mutationWithRLS({
  args: {
    conversationId: v.id('conversations'),
    // Omit ⇒ un-queue. A Better Auth teamId within the conversation's org.
    assigneeTeamId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new ConvexError({ code: 'UNAUTHENTICATED' });
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) {
      throw new ConvexError({
        code: 'conversation_not_found',
        message: 'Conversation not found',
      });
    }
    // Admin gate — resolve the caller's role from the member mirror on a raw ctx
    // (this RLS ctx can't read `memberMirror`), mirroring assignConversation.
    const role = await ctx.runQuery(
      internal.members.internal_queries.getMirrorMemberRole,
      { organizationId: conversation.organizationId, userId: authUser.userId },
    );
    if (role !== 'owner' && role !== 'admin') {
      throw new ConvexError({
        code: 'FORBIDDEN',
        message: 'Only admins can assign conversations',
      });
    }

    const previousAssigneeTeamId = conversation.assigneeTeamId ?? null;
    const nextAssigneeTeamId = args.assigneeTeamId ?? null;
    // Unchanged ⇒ no write, no audit, no notify.
    if (previousAssigneeTeamId === nextAssigneeTeamId) return null;

    // The target team must belong to the conversation's org — defense-in-depth
    // over the org-check-first RLS. Validate on a raw ctx via the members query.
    if (nextAssigneeTeamId) {
      const teamOrgId = await ctx.runQuery(
        internal.members.internal_queries.getTeamOrganizationId,
        { teamId: nextAssigneeTeamId },
      );
      if (teamOrgId !== conversation.organizationId) {
        throw new ConvexError({
          code: 'team_not_in_org',
          message: 'Team does not belong to this organization',
        });
      }
    }

    await ctx.db.patch(args.conversationId, {
      assigneeTeamId: nextAssigneeTeamId ?? undefined,
    });

    await emitAuditSuccess(ctx, {
      auditCtx: await buildAuditContext(ctx, conversation.organizationId),
      action: nextAssigneeTeamId
        ? 'assign_conversation_team'
        : 'unassign_conversation_team',
      category: 'data',
      resourceType: 'conversation',
      resourceId: String(args.conversationId),
      resourceName: conversation.subject,
      previousState: { assigneeTeamId: previousAssigneeTeamId },
      newState: { assigneeTeamId: nextAssigneeTeamId },
    });

    // Notify the team's members (the fan-out excludes the actor) on a raw ctx —
    // a cross-user userNotifications write isn't allowed under RLS. Skip on
    // un-queue (no one to tell).
    if (nextAssigneeTeamId) {
      await ctx.scheduler.runAfter(
        0,
        internal.conversations.internal_mutations.notifyAssignedTeam,
        {
          conversationId: args.conversationId,
          assigneeTeamId: nextAssigneeTeamId,
          actorUserId: authUser.userId,
        },
      );
    }
    return null;
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

    const connectorName = conversation.connectorName;
    if (!connectorName) {
      // Fail closed rather than silently routing through Outlook — a Gmail/IMAP
      // (or unstamped) conversation would otherwise dispatch to the wrong
      // provider. Mirrors `reply_to_conversation`'s no-silent-fallback rule.
      throw new ConvexError({
        code: 'conversation_connector_missing',
        message:
          'Conversation has no connector to download attachments through — unavailable until a sync stamps its connectorName',
      });
    }

    await ctx.scheduler.runAfter(
      0,
      internal.conversations.internal_actions.downloadAttachmentsAction,
      {
        messageId: args.messageId,
        organizationId: conversation.organizationId,
        connectorName,
        externalMessageId: message.externalMessageId,
      },
    );

    return null;
  },
});

/**
 * Cancel an outbound send while it's still inside its undo window (queued,
 * delivery scheduled but not fired). Deletes the message and returns the
 * composer's markdown so the client can restore the draft.
 */
export const undoSendMessage = mutationWithRLS({
  args: {
    messageId: v.id('conversationMessages'),
  },
  returns: v.object({
    sourceMarkdown: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    return await undoSendMessageHelper(ctx, args);
  },
});

/**
 * Re-attempt delivery of a failed outbound message. Rebuilds the send from
 * the stored row and schedules it immediately (no undo window on a retry).
 */
export const retrySendMessage = mutationWithRLS({
  args: {
    messageId: v.id('conversationMessages'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await retrySendMessageHelper(ctx, args);
    return null;
  },
});

/**
 * Remove a failed outbound message from the thread. The email never delivered,
 * so deleting the row discards it without a composer restore (use Undo for
 * still-queued sends that should come back as a draft).
 */
export const discardOutboundMessage = mutationWithRLS({
  args: {
    messageId: v.id('conversationMessages'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await discardOutboundMessageHelper(ctx, args);
    return null;
  },
});
