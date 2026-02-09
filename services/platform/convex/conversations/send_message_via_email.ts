import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

import { internal } from '../_generated/api';
import * as AuditLogHelpers from '../audit_logs/helpers';
import { buildAuditContext } from '../lib/helpers/build_audit_context';

interface UploadedAttachment {
  storageId: string;
  name: string;
  size: number;
  type: string;
  contentType: string;
}

export interface SendMessageViaEmailArgs {
  conversationId: Id<'conversations'>;
  organizationId: string;
  content: string;
  providerId?: Id<'emailProviders'>;
  to: Array<string>;
  cc?: Array<string>;
  bcc?: Array<string>;
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
  inReplyTo?: string;
  references?: Array<string>;
  headers?: Record<string, string>;
  attachments?: Array<UploadedAttachment>;
}

function getProviderEmail(provider: Doc<'emailProviders'>): string | undefined {
  if (provider.authMethod === 'password' && provider.passwordAuth) {
    return provider.passwordAuth.user;
  }
  if (provider.authMethod === 'oauth2' && provider.metadata) {
    const oauth2User = (provider.metadata as Record<string, unknown>)
      .oauth2_user;
    return typeof oauth2User === 'string' ? oauth2User : undefined;
  }
  return undefined;
}

function extractSenderEmail(provider: Doc<'emailProviders'>): string {
  if (provider.authMethod === 'password' && provider.passwordAuth) {
    return provider.passwordAuth.user;
  }
  if (provider.authMethod === 'oauth2' && provider.metadata) {
    const oauth2User = (provider.metadata as Record<string, unknown>)
      .oauth2_user;
    if (oauth2User && typeof oauth2User === 'string') {
      return oauth2User;
    }
    throw new Error(
      'OAuth2 provider missing user email. Please re-authorize the provider.',
    );
  }
  throw new Error('Invalid email provider configuration');
}

function extractOriginalRecipientEmail(
  metadata: Record<string, unknown> | undefined,
): string | undefined {
  if (!metadata?.to) return undefined;

  if (typeof metadata.to === 'string') return metadata.to;

  if (Array.isArray(metadata.to) && metadata.to.length > 0) {
    const first = metadata.to[0] as { address?: string } | string;
    return typeof first === 'string' ? first : first.address;
  }

  return undefined;
}

async function resolveProvider(
  ctx: MutationCtx,
  conversation: Doc<'conversations'>,
  organizationId: string,
): Promise<Doc<'emailProviders'>> {
  if (conversation.providerId) {
    const provider = await ctx.db.get(conversation.providerId);
    if (provider) return provider;
  }

  const activeProvider = await ctx.db
    .query('emailProviders')
    .withIndex('by_organizationId_and_status', (q) =>
      q.eq('organizationId', organizationId).eq('status', 'active'),
    )
    .first();

  if (!activeProvider) {
    throw new Error(
      'No email provider found. Please configure an email provider for this organization.',
    );
  }

  const originalRecipientEmail = extractOriginalRecipientEmail(
    conversation.metadata as Record<string, unknown> | undefined,
  );
  const activeProviderEmail = getProviderEmail(activeProvider);

  if (originalRecipientEmail && activeProviderEmail) {
    if (
      activeProviderEmail.toLowerCase() !== originalRecipientEmail.toLowerCase()
    ) {
      throw new Error(
        `Cannot send reply: The active email provider (${activeProviderEmail}) does not match ` +
          `the original recipient email (${originalRecipientEmail}). ` +
          `Please configure the correct email provider.`,
      );
    }
  }

  return activeProvider;
}

export async function sendMessageViaEmail(
  ctx: MutationCtx,
  args: SendMessageViaEmailArgs,
): Promise<Id<'conversationMessages'>> {
  const conversation = await ctx.db.get(args.conversationId);
  if (!conversation) {
    throw new Error('Conversation not found');
  }

  if (conversation.organizationId !== args.organizationId) {
    throw new Error('Conversation does not belong to organization');
  }

  const organizationId = conversation.organizationId;

  const provider = await resolveProvider(ctx, conversation, organizationId);
  const senderEmail = extractSenderEmail(provider);

  const messageMetadata: Record<string, unknown> = {
    sender: senderEmail,
    isCustomer: false,
    to: args.to,
    subject: args.subject,
    ...(args.cc && { cc: args.cc }),
    ...(args.bcc && { bcc: args.bcc }),
    ...(args.replyTo && { replyTo: args.replyTo }),
    ...(args.inReplyTo && { inReplyTo: args.inReplyTo }),
    ...(args.references && { references: args.references }),
    ...(args.headers && { headers: args.headers }),
    ...(args.attachments && { attachments: args.attachments }),
  };

  const now = Date.now();
  const messageId = await ctx.db.insert('conversationMessages', {
    organizationId,
    conversationId: args.conversationId,
    providerId: provider._id,
    channel: 'email',
    direction: 'outbound',
    deliveryState: 'queued',
    content: args.content,
    sentAt: now,
    metadata: messageMetadata,
  });

  const emailPayload = {
    messageId,
    organizationId,
    providerId: provider._id,
    from: senderEmail,
    to: args.to,
    cc: args.cc,
    bcc: args.bcc,
    subject: args.subject,
    html: args.html,
    text: args.text,
    replyTo: args.replyTo,
    inReplyTo: args.inReplyTo,
    references: args.references,
    headers: args.headers,
    retryCount: 0,
  };

  const sendMethod = provider.sendMethod || 'smtp';
  const sendAction =
    sendMethod === 'api'
      ? internal.email_providers.internal_actions.sendMessageViaAPI
      : internal.email_providers.internal_actions.sendMessageViaSMTP;

  await ctx.scheduler.runAfter(0, sendAction, emailPayload);

  const existingMetadata =
    (conversation.metadata as Record<string, unknown>) || {};
  await ctx.db.patch(args.conversationId, {
    lastMessageAt: now,
    providerId: conversation.providerId || provider._id,
    metadata: {
      ...existingMetadata,
      last_message_at: now,
    },
  });

  const auditContext = await buildAuditContext(ctx, organizationId);

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
    const approvedBy = auditContext.actor.id;
    const approvalExistingMetadata =
      (pendingApproval.metadata as Record<string, unknown>) || {};

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
        ...(args.bcc && { sentBcc: args.bcc }),
      },
    });
  }

  await AuditLogHelpers.logSuccess(
    ctx,
    auditContext,
    'send_message_via_email',
    'data',
    'conversationMessage',
    String(messageId),
    args.subject,
    undefined,
    {
      conversationId: String(args.conversationId),
      to: args.to,
      subject: args.subject,
      hasAttachments: !!args.attachments?.length,
    },
  );

  return messageId;
}
