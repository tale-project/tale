import { attachmentsForMetadata } from './attachments_for_metadata';
import type { EmailType } from './types';

/**
 * Build conversation metadata object
 */
export function buildConversationMetadata(
  email: EmailType,
  additionalMetadata?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    from: email.from,
    to: email.to,
    cc: email.cc,
    bcc: email.bcc,
    receivedAt: email.date,
    sentAt: email.date,
    body: (email.html || email.text) ?? null,
    headers: email.headers,
    uid: email.uid ?? null,
    flags: email.flags,
    attachments: attachmentsForMetadata(email.attachments),
    ...additionalMetadata,
  };
}
