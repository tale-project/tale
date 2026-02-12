import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

import { internal } from '../_generated/api';
import * as AuditLogHelpers from '../audit_logs/helpers';
import { buildAuditContext } from '../lib/helpers/build_audit_context';

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

  const now = Date.now();
  const messageMetadata: Record<string, unknown> = {
    sender: 'integration',
    isCustomer: false,
    to: args.to,
    subject: args.subject,
    integrationName: args.integrationName,
    ...(args.cc && { cc: args.cc }),
    ...(args.inReplyTo && { inReplyTo: args.inReplyTo }),
    ...(args.references && { references: args.references }),
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
