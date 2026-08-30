/**
 * Server-side reply to a conversation.
 *
 * Derives everything the send path needs from the conversation row itself —
 * recipient (the customer's email), a `Re:`-prefixed subject, the html/text
 * body split, and the connector to send through — then delegates to
 * `sendMessageViaConnector` (threading headers, reply-from resolution and
 * audit all live there). The conversation's own `connectorName` is
 * authoritative: replying without one is an error, never a silent fallback
 * to a default provider.
 */

import { AppError } from '../../lib/shared/errors/app-error';
import type { MutationCtx } from '../lib/ctx';
import type { Id } from '../lib/rows';
import { sendMessageViaConnector } from './send_message_via_connector';
import type { BulkOperationResult } from './types';

/** Placeholder email used when a contact record carries no real address. */
const UNKNOWN_CONTACT_EMAIL = 'unknown@example.com';

/** Subject used when the conversation itself has none. */
const FALLBACK_REPLY_SUBJECT = 'Re: Conversation';

/**
 * Upper bound for one bulk reply call — each reply performs several writes
 * and schedules an outbound send action, so the batch must stay small enough
 * for a single mutation transaction.
 */
export const BULK_REPLY_CAP = 50;

export interface ReplyToConversationArgs {
  conversationId: Id<'conversations'>;
  organizationId: string;
  content: string;
  /** Composer markdown at send time — stored for undo-send draft restore. */
  sourceMarkdown?: string;
  attachments?: Array<{
    storageId: Id<'_storage'>;
    fileName: string;
    contentType: string;
    size: number;
  }>;
}

/** `Re:`-prefix a subject exactly once (case-insensitive, idempotent). */
export function buildReplySubject(subject: string | undefined): string {
  const trimmed = subject?.trim();
  if (!trimmed) return FALLBACK_REPLY_SUBJECT;
  return /^re:/i.test(trimmed) ? trimmed : `Re: ${trimmed}`;
}

/** Split composer content into an html body and a tag-stripped text body. */
export function splitHtmlText(content: string): { html: string; text: string } {
  return { html: content, text: content.replace(/<[^>]*>/g, '') };
}

export async function replyToConversation(
  ctx: MutationCtx,
  args: ReplyToConversationArgs,
): Promise<Id<'conversationMessages'>> {
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

  const connectorName = conversation.connectorName;
  if (!connectorName) {
    throw new AppError({
      code: 'conversation_connector_missing',
      message:
        'Conversation has no connector to reply through — reply is unavailable until a sync stamps its connectorName',
    });
  }

  // Resolve the reply-to address from the conversation's contact (issue #2618).
  const contact = conversation.contactId
    ? await ctx.db.get(conversation.contactId)
    : null;
  const recipientEmail = contact?.email;
  if (!recipientEmail || recipientEmail === UNKNOWN_CONTACT_EMAIL) {
    throw new AppError({
      code: 'customer_email_not_found',
      message: 'Conversation has no contact email to reply to',
    });
  }

  const subject = buildReplySubject(conversation.subject);
  const { html, text } = splitHtmlText(args.content);

  return await sendMessageViaConnector(ctx, {
    conversationId: args.conversationId,
    organizationId: args.organizationId,
    connectorName,
    content: args.content,
    to: [recipientEmail],
    subject,
    html,
    text,
    ...(args.sourceMarkdown ? { sourceMarkdown: args.sourceMarkdown } : {}),
    ...(args.attachments?.length ? { attachments: args.attachments } : {}),
  });
}

export async function bulkReplyToConversations(
  ctx: MutationCtx,
  args: {
    conversationIds: Array<Id<'conversations'>>;
    organizationId: string;
    content: string;
  },
): Promise<BulkOperationResult> {
  if (args.conversationIds.length > BULK_REPLY_CAP) {
    throw new AppError({
      code: 'bulk_reply_too_many',
      message: `Cannot reply to more than ${BULK_REPLY_CAP} conversations at once`,
    });
  }

  let successCount = 0;
  const errors: string[] = [];

  // Sequential on purpose: replies are heavier than status patches. A
  // per-conversation failure is recorded and the rest still go out — the
  // partial-failure contract of the other bulk_* helpers. This is
  // transaction-safe because every throw in replyToConversation happens
  // before its first write.
  for (const conversationId of args.conversationIds) {
    try {
      await replyToConversation(ctx, {
        conversationId,
        organizationId: args.organizationId,
        content: args.content,
      });
      successCount++;
    } catch (error) {
      errors.push(
        `Failed to reply to ${conversationId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  return {
    successCount,
    failedCount: args.conversationIds.length - successCount,
    errors,
  };
}
