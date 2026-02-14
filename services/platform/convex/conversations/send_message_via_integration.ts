import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

import { internal } from '../_generated/api';
import * as AuditLogHelpers from '../audit_logs/helpers';
import { buildAuditContext } from '../lib/helpers/build_audit_context';
import { toId } from '../lib/type_cast_helpers';
import { buildThreadingHeaders } from './build_threading_headers';

export interface SendMessageViaIntegrationArgs {
  conversationId: Id<'conversations'>;
  organizationId: string;
  integrationName: string;
  content: string;
  to: Array<string>;
  cc?: Array<string>;
  subject: string;
  html?: string;
  text?: string;
  inReplyTo?: string;
  references?: Array<string>;
  attachments?: Array<{
    storageId: string;
    fileName: string;
    contentType: string;
    size: number;
  }>;
}

export async function sendMessageViaIntegration(
  ctx: MutationCtx,
  args: SendMessageViaIntegrationArgs,
): Promise<Id<'conversationMessages'>> {
  const conversation = await ctx.db.get(args.conversationId);
  if (!conversation) {
    throw new Error('Conversation not found');
  }

  if (conversation.organizationId !== args.organizationId) {
    throw new Error('Conversation does not belong to organization');
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

  // Build attachment metadata so outbound messages display their attachments
  let attachmentsMeta: Array<Record<string, unknown>> | undefined;
  if (args.attachments && args.attachments.length > 0) {
    attachmentsMeta = await Promise.all(
      args.attachments.map(async (att) => {
        const url = await ctx.storage.getUrl(toId<'_storage'>(att.storageId));
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
    sender: 'integration',
    isCustomer: false,
    to: args.to,
    subject: args.subject,
    integrationName: args.integrationName,
    ...(args.cc && { cc: args.cc }),
    ...(inReplyTo && { inReplyTo }),
    ...(references && { references }),
    ...(attachmentsMeta && { attachments: attachmentsMeta }),
  };

  const messageId = await ctx.db.insert('conversationMessages', {
    organizationId: args.organizationId,
    conversationId: args.conversationId,
    channel: 'email',
    direction: 'outbound',
    deliveryState: 'queued',
    content: args.content,
    sentAt: now,
    metadata: messageMetadata,
  });

  await ctx.scheduler.runAfter(
    0,
    internal.conversations.internal_actions.sendMessageViaIntegrationAction,
    {
      messageId,
      organizationId: args.organizationId,
      integrationName: args.integrationName,
      to: args.to,
      cc: args.cc,
      subject: args.subject,
      body: args.html || args.text || args.content,
      contentType: args.html ? 'HTML' : 'Text',
      inReplyTo,
      references,
      ...(args.attachments?.length ? { attachments: args.attachments } : {}),
    },
  );

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
      status: 'approved',
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

  await AuditLogHelpers.logSuccess(
    ctx,
    await buildAuditContext(ctx, args.organizationId),
    'send_message_via_integration',
    'data',
    'conversationMessage',
    String(messageId),
    args.subject,
    undefined,
    {
      conversationId: String(args.conversationId),
      integrationName: args.integrationName,
      to: args.to,
      subject: args.subject,
    },
  );

  return messageId;
}
