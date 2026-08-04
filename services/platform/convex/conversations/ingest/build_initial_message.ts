import { attachmentsForMetadata } from './attachments_for_metadata';
import { buildEmailMetadata } from './build_email_metadata';
import { normalizeExternalMessageId } from './normalize_external_message_id';
import type { EmailType } from './types';

/**
 * Build initial message object for conversation creation
 */
export function buildInitialMessage(
  email: EmailType,
  isCustomer: boolean,
  status: 'delivered' | 'sent',
  connectorName?: string,
) {
  const emailTimestamp = new Date(email.date).getTime();
  const attachments = attachmentsForMetadata(email.attachments);

  return {
    sender: email.from?.[0]?.address || email.from?.[0]?.name || 'unknown',
    content: email.html || email.text || '',
    isCustomer,
    status,
    externalMessageId: normalizeExternalMessageId(email.messageId),
    metadata: buildEmailMetadata(email),
    sentAt: emailTimestamp,
    deliveredAt: status === 'delivered' ? emailTimestamp : undefined,
    ...(attachments?.length ? { attachments } : {}),
    ...(connectorName ? { connectorName } : {}),
  };
}
