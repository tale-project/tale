import type { ActionCtx } from '../../../../_generated/server';
import { internal } from '../../../../_generated/api';
import type { Id } from '../../../../_generated/dataModel';
import type { EmailType } from './types';
import { buildEmailMetadata } from './build_email_metadata';

/**
 * Add a message to an existing conversation
 */
export async function addMessageToConversation(
  ctx: ActionCtx,
  conversationId: Id<'conversations'>,
  organizationId: string,
  email: EmailType,
  isCustomer: boolean,
  status: 'delivered' | 'sent',
  providerId?: Id<'emailProviders'>,
) {
  const emailTimestamp = new Date(email.date).getTime();

  await ctx.runMutation(
    internal.conversations.addMessageToConversationInternal,
    {
      conversationId,
      organizationId,
      sender: email.from?.[0]?.address || email.from?.[0]?.name || 'unknown',
      content: email.html || email.text || '',
      isCustomer,
      status,
      attachment: email.attachments,
      providerId,
      externalMessageId: email.messageId,
      metadata: buildEmailMetadata(email),
      sentAt: emailTimestamp,
      // For email sync, set deliveredAt to email timestamp since the email exists in the mailbox
      deliveredAt: status === 'delivered' ? emailTimestamp : undefined,
    },
  );
}
