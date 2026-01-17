import type { EmailType } from './types';
import { buildEmailMetadata } from './build_email_metadata';

/**
 * Build initial message object for conversation creation
 */
export function buildInitialMessage(
  email: EmailType,
  isCustomer: boolean,
  status: 'delivered' | 'sent',
) {
  const emailTimestamp = new Date(email.date).getTime();

  return {
    sender: email.from?.[0]?.address || email.from?.[0]?.name || 'unknown',
    content: email.html || email.text || '',
    isCustomer,
    status,
    attachment: email.attachments,
    externalMessageId: email.messageId,
    metadata: buildEmailMetadata(email),
    sentAt: emailTimestamp,
    // For email sync, set deliveredAt to email timestamp since the email exists in the mailbox
    deliveredAt: status === 'delivered' ? emailTimestamp : undefined,
  };
}
