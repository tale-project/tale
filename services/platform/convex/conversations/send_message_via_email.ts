/**
 * Send a message via email (business logic)
 * Creates a conversation message with 'queued' status and schedules immediate email send
 * Supports both SMTP and API sending (Gmail API / Microsoft Graph)
 * Retry logic with exponential backoff (30s, 60s, 120s) is handled by the consumer
 * After 3 failed retries, messages are moved to 'failed' state
 * Automatically approves any pending approval for this conversation
 */

import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { internal } from '../_generated/api';
import { getAuthenticatedUser } from '../lib/rls/auth/get_authenticated_user';
import * as AuditLogHelpers from '../audit_logs/helpers';

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
  // Email-specific fields
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

export async function sendMessageViaEmail(
  ctx: MutationCtx,
  args: SendMessageViaEmailArgs,
): Promise<Id<'conversationMessages'>> {
  // Get the parent conversation to determine which provider to use
  const conversation = await ctx.db.get(args.conversationId);
  if (!conversation) {
    throw new Error('Conversation not found');
  }

  // Get the original recipient email from conversation metadata (this is our email address)
  const conversationMetadata = conversation.metadata as Record<string, unknown> | undefined;
  let originalRecipientEmail: string | undefined;
  if (conversationMetadata?.to) {
    if (typeof conversationMetadata.to === 'string') {
      originalRecipientEmail = conversationMetadata.to;
    } else if (Array.isArray(conversationMetadata.to) && conversationMetadata.to.length > 0) {
      const toObj = conversationMetadata.to[0] as { address?: string } | string;
      originalRecipientEmail = typeof toObj === 'string' ? toObj : toObj.address;
    }
  }

  // Helper to get provider email
  const getProviderEmail = (p: NonNullable<typeof provider>): string | undefined => {
    if (p.authMethod === 'password' && p.passwordAuth) {
      return p.passwordAuth.user;
    } else if (p.authMethod === 'oauth2' && p.metadata) {
      const oauth2User = (p.metadata as Record<string, unknown>).oauth2_user;
      return typeof oauth2User === 'string' ? oauth2User : undefined;
    }
    return undefined;
  };

  // 1. Try to use the provider from the conversation
  let provider;
  if (conversation.providerId) {
    provider = await ctx.db.get(conversation.providerId);
  }

  // 2. If no conversation provider, find an active provider that matches the original recipient email
  if (!provider) {
    const activeProvider = await ctx.db
      .query('emailProviders')
      .withIndex('by_organizationId_and_status', (q) =>
        q.eq('organizationId', args.organizationId).eq('status', 'active'),
      )
      .first();

    if (activeProvider) {
      const activeProviderEmail = getProviderEmail(activeProvider);

      // Only use the active provider if its email matches the original recipient
      if (originalRecipientEmail && activeProviderEmail) {
        if (activeProviderEmail.toLowerCase() === originalRecipientEmail.toLowerCase()) {
          provider = activeProvider;
        } else {
          throw new Error(
            `Cannot send reply: The active email provider (${activeProviderEmail}) does not match ` +
            `the original recipient email (${originalRecipientEmail}). ` +
            `Please configure the correct email provider.`
          );
        }
      } else {
        // No original recipient email to compare, use the active provider
        provider = activeProvider;
      }
    }
  }

  if (!provider) {
    throw new Error(
      `No email provider found. Please configure an email provider for this organization.`
    );
  }

  // Extract sender email from provider
  // For password auth: use the user field
  // For OAuth2 auth: use the oauth2_user from metadata
  let senderEmail: string;
  if (provider.authMethod === 'password' && provider.passwordAuth) {
    senderEmail = provider.passwordAuth.user;
  } else if (provider.authMethod === 'oauth2' && provider.metadata) {
    const oauth2User = provider.metadata.oauth2_user;
    if (!oauth2User || typeof oauth2User !== 'string') {
      throw new Error(
        'OAuth2 provider missing user email. Please re-authorize the provider.',
      );
    }
    senderEmail = oauth2User;
  } else {
    throw new Error('Invalid email provider configuration');
  }

  // Create the message with 'queued' status
  // Use the provider from the conversation (or the one we just determined)
  const messageMetadata: Record<string, unknown> = {
    sender: senderEmail,
    isCustomer: false,
    to: args.to,
    subject: args.subject,
  };
  if (args.cc) messageMetadata.cc = args.cc;
  if (args.bcc) messageMetadata.bcc = args.bcc;
  if (args.replyTo) messageMetadata.replyTo = args.replyTo;
  if (args.inReplyTo) messageMetadata.inReplyTo = args.inReplyTo;
  if (args.references) messageMetadata.references = args.references;
  if (args.headers) messageMetadata.headers = args.headers;
  if (args.attachments) messageMetadata.attachments = args.attachments;

  const now = Date.now();
  const messageId = await ctx.db.insert('conversationMessages', {
    organizationId: args.organizationId,
    conversationId: args.conversationId,
    providerId: provider._id, // Always use the provider we determined above
    channel: 'email',
    direction: 'outbound',
    deliveryState: 'queued',
    content: args.content,
    sentAt: now, // Set sentAt when message is created for UI display
     
    metadata: messageMetadata as any,
  });

  // Determine send method: 'api' or 'smtp' (default to 'smtp' for backwards compatibility)
  const sendMethod = provider.sendMethod || 'smtp';

  // Schedule email send immediately (retry logic with exponential backoff is handled by consumer)
  // Always use the provider we determined above (from conversation or fallback)
  if (sendMethod === 'api') {
    // Send via API (Gmail API / Microsoft Graph)
    await ctx.scheduler.runAfter(
      0, // Send immediately - retry backoff is handled by consumer on failure
      internal.email_providers.internal_actions.sendMessageViaAPIInternal,
      {
        messageId,
        organizationId: args.organizationId,
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
        retryCount: 0, // Initial attempt
      },
    );
  } else {
    // Send via SMTP (default)
    await ctx.scheduler.runAfter(
      0, // Send immediately - retry backoff is handled by consumer on failure
      internal.email_providers.internal_actions.sendMessageViaSMTPInternal,
      {
        messageId,
        organizationId: args.organizationId,
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
        retryCount: 0, // Initial attempt
      },
    );
  }

  // Update conversation with lastMessageAt and providerId if not already set
  // This ensures the conversation remembers which provider to use for future replies
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

  // Auto-approve any pending approval for this conversation
  // This allows the workflow to continue after the user sends the message
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
    // Get the authenticated user for audit trail
    const authUser = await getAuthenticatedUser(ctx);
    const approvedBy = authUser?.userId || 'system';

    // Get existing metadata and add the actual sent content
    const existingMetadata =
      (pendingApproval.metadata as Record<string, unknown>) || {};

    // Update approval status to approved and record the actual sent content
    const approvalMetadata: Record<string, unknown> = {
      ...existingMetadata,
      sentContent: args.content,
      sentTo: args.to,
      sentSubject: args.subject,
      sentAt: Date.now(),
    };
    if (args.html) approvalMetadata.sentHtml = args.html;
    if (args.text) approvalMetadata.sentText = args.text;
    if (args.cc) approvalMetadata.sentCc = args.cc;
    if (args.bcc) approvalMetadata.sentBcc = args.bcc;

    await ctx.db.patch(pendingApproval._id, {
      status: 'approved',
      approvedBy,
      reviewedAt: Date.now(),
       
      metadata: approvalMetadata as any,
    });
  }

  const authUser = await getAuthenticatedUser(ctx);
  await AuditLogHelpers.logSuccess(
    ctx,
    {
      organizationId: args.organizationId,
      actor: authUser
        ? { id: authUser.userId, email: authUser.email, type: 'user' as const }
        : { id: 'system', type: 'system' as const },
    },
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
