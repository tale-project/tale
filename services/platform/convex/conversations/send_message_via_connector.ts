import { AppError } from '../../lib/shared/errors/app-error';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { emitAuditSuccess } from '../audit_logs/emit';
import { buildAuditContext } from '../lib/helpers/build_audit_context';
import { validateConversationAttachmentCaps } from './attachments';
import { buildThreadingHeaders } from './build_threading_headers';
import { inboundRecipientAddress } from './reply_from';

/**
 * Undo window: the outbound send action is scheduled this far in the future so
 * the sender can cancel it (`undoSendMessage`) — the email-provider "Undo
 * send" experience. Applies to every path that funnels through
 * `sendMessageViaConnector` (reply, compose, bulk reply).
 */
export const UNDO_SEND_DELAY_MS = 10_000;

export interface SendMessageViaConnectorArgs {
  conversationId: Id<'conversations'>;
  organizationId: string;
  connectorName: string;
  content: string;
  to: Array<string>;
  cc?: Array<string>;
  subject: string;
  html?: string;
  text?: string;
  inReplyTo?: string;
  references?: Array<string>;
  /**
   * The composer's markdown state at send time. Stored in message metadata
   * (never part of the outbound email) so an undo can hand the draft back to
   * the composer exactly as the user wrote it.
   */
  sourceMarkdown?: string;
  attachments?: Array<{
    storageId: Id<'_storage'>;
    fileName: string;
    contentType: string;
    size: number;
  }>;
}

export async function sendMessageViaConnector(
  ctx: MutationCtx,
  args: SendMessageViaConnectorArgs,
): Promise<Id<'conversationMessages'>> {
  // Server-side re-enforcement of the composer's attachment caps — the single
  // choke point every write path funnels through (`replyToConversation` and
  // `composeEmailConversation` both delegate here), so one check covers all
  // of them. A denial throws synchronously before any read/write (#2661).
  validateConversationAttachmentCaps(args.attachments);

  const conversation = await ctx.db.get(args.conversationId);
  if (!conversation) {
    throw new AppError({
      code: 'conversation_not_found',
      message: 'Conversation not found',
    });
  }

  if (conversation.organizationId !== args.organizationId) {
    throw new AppError({
      code: 'conversation_org_mismatch',
      message: 'Conversation does not belong to organization',
    });
  }

  // Resolve threading headers from the conversation's message history
  const latestMessage = !args.inReplyTo
    ? await ctx.db
        .query('conversationMessages')
        .withIndex('by_conversationId_and_deliveredAt', (q) =>
          q.eq('conversationId', args.conversationId),
        )
        .order('desc')
        .first()
    : null;

  const { inReplyTo, references } = buildThreadingHeaders({
    inReplyTo: args.inReplyTo,
    references: args.references,
    latestMessageExternalId: latestMessage?.externalMessageId ?? undefined,
    conversationExternalMessageId: conversation.externalMessageId,
  });

  const now = Date.now();

  // Save file metadata and build attachment metadata for outbound messages
  let attachmentsMeta: Array<Record<string, unknown>> | undefined;
  if (args.attachments && args.attachments.length > 0) {
    attachmentsMeta = await Promise.all(
      args.attachments.map(async (att) => {
        await ctx.runMutation(
          internal.file_metadata.internal_mutations.saveFileMetadata,
          {
            organizationId: args.organizationId,
            storageId: att.storageId,
            fileName: att.fileName,
            contentType: att.contentType,
            size: att.size,
          },
        );
        const url = await ctx.storage.getUrl(att.storageId);
        return {
          id: att.storageId,
          filename: att.fileName,
          contentType: att.contentType,
          size: att.size,
          storageId: att.storageId,
          url: url ?? undefined,
        };
      }),
    );
  }

  const messageMetadata: Record<string, unknown> = {
    sender: 'connector',
    isCustomer: false,
    to: args.to,
    subject: args.subject,
    connectorName: args.connectorName,
    // Stamped so the client can count down the undo window; the send action
    // fires at this time.
    scheduledSendAt: now + UNDO_SEND_DELAY_MS,
    // How the action interprets the body — retrySendMessage rebuilds the
    // action args from this row, so record which mode the send used.
    sendContentType: args.html ? 'HTML' : 'Text',
    ...(args.sourceMarkdown && { sourceMarkdown: args.sourceMarkdown }),
    ...(args.cc && { cc: args.cc }),
    ...(inReplyTo && { inReplyTo }),
    ...(references && { references }),
    ...(attachmentsMeta && { attachments: attachmentsMeta }),
  };

  const messageId = await ctx.db.insert('conversationMessages', {
    organizationId: args.organizationId,
    conversationId: args.conversationId,
    // Top-level field (not just metadata) so the sent-folder sync cursor
    // (queryLatestMessageByDeliveryState, filtered by connectorName via index)
    // advances past native sends and doesn't re-fetch their appended Sent copy.
    connectorName: args.connectorName,
    channel: 'email',
    direction: 'outbound',
    deliveryState: 'queued',
    content: args.content,
    sentAt: now,
    deliveredAt: now,
    metadata: messageMetadata,
  });

  // Reply from the address the customer originally wrote to (multi-address
  // support). The send action validates it against the sender's domain and
  // falls back to the connector's configured From when it can't be used.
  const replyFrom = inboundRecipientAddress(
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- metadata is jsonRecord
    conversation.metadata as Record<string, unknown> | undefined,
  );

  // Delayed by the undo window; `undoSendMessage` cancels this scheduled job
  // (via the `scheduledSendId` stamped below) and deletes the message row.
  const scheduledSendId = await ctx.scheduler.runAfter(
    UNDO_SEND_DELAY_MS,
    internal.conversations.internal_actions.sendMessageViaConnectorAction,
    {
      messageId,
      organizationId: args.organizationId,
      connectorName: args.connectorName,
      to: args.to,
      cc: args.cc,
      subject: args.subject,
      body: args.html || args.text || args.content,
      contentType: args.html ? 'HTML' : 'Text',
      inReplyTo,
      references,
      ...(replyFrom ? { from: replyFrom } : {}),
      ...(args.attachments?.length ? { attachments: args.attachments } : {}),
    },
  );

  await ctx.db.patch(messageId, {
    metadata: {
      ...messageMetadata,
      scheduledSendId: String(scheduledSendId),
    },
  });

  const existingMetadata = conversation.metadata ?? {};
  await ctx.db.patch(args.conversationId, {
    lastMessageAt: now,
    metadata: {
      ...existingMetadata,
      last_message_at: now,
    },
  });

  const pendingApproval = await ctx.db
    .query('approvals')
    .withIndex('by_resourceType_and_resourceId_and_status', (q) =>
      q
        .eq('resourceType', 'conversations' as const)
        .eq('resourceId', args.conversationId)
        .eq('status', 'pending'),
    )
    .first();

  if (pendingApproval) {
    const auditContext = await buildAuditContext(ctx, args.organizationId);
    const approvedBy = auditContext.actor.id;
    const approvalExistingMetadata = pendingApproval.metadata ?? {};

    await ctx.db.patch(pendingApproval._id, {
      status: 'completed',
      approvedBy,
      reviewedAt: Date.now(),
      metadata: {
        ...approvalExistingMetadata,
        sentContent: args.content,
        sentTo: args.to,
        sentSubject: args.subject,
        sentAt: Date.now(),
        ...(args.html && { sentHtml: args.html }),
        ...(args.text && { sentText: args.text }),
        ...(args.cc && { sentCc: args.cc }),
      },
    });
  }

  await emitAuditSuccess(ctx, {
    auditCtx: await buildAuditContext(ctx, args.organizationId),
    action: 'send_message_via_connector',
    category: 'data',
    resourceType: 'conversationMessage',
    resourceId: String(messageId),
    resourceName: args.subject,
    newState: {
      conversationId: String(args.conversationId),
      connectorName: args.connectorName,
      to: args.to,
      subject: args.subject,
    },
  });

  return messageId;
}
