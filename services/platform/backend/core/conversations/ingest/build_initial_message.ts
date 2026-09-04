import { attachmentsForMetadata } from './attachments_for_metadata';
import { buildEmailMetadata } from './build_email_metadata';
import { emailStamps } from './email_epoch';
import { normalizeExternalMessageId } from './normalize_external_message_id';
import type { EmailType } from './types';

/**
 * Build initial message object for conversation creation. The instant stamps
 * ride {@link emailStamps}: absent, never NaN, for a message with no readable
 * date (Gmail's no-Date-header shape hands back an epoch-ms string).
 */
export function buildInitialMessage(
  email: EmailType,
  isCustomer: boolean,
  status: 'delivered' | 'sent',
  connectorName?: string,
) {
  const attachments = attachmentsForMetadata(email.attachments);

  return {
    sender: email.from?.[0]?.address || email.from?.[0]?.name || 'unknown',
    content: email.html || email.text || '',
    isCustomer,
    status,
    externalMessageId: normalizeExternalMessageId(email.messageId),
    metadata: buildEmailMetadata(email),
    ...emailStamps(email.date, status === 'delivered'),
    ...(attachments?.length ? { attachments } : {}),
    ...(connectorName ? { connectorName } : {}),
  };
}
