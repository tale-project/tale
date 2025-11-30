import type { EmailType } from '../types';

/**
 * Build conversation metadata object
 */
export function buildConversationMetadata(
  email: EmailType,
  additionalMetadata?: Record<string, unknown>,
) {
  return {
    from: email.from,
    to: email.to,
    cc: email.cc,
    bcc: email.bcc,
    receivedAt: email.date,
    sentAt: email.date,
    body: email.html || email.text,
    headers: email.headers,
    uid: email.uid,
    flags: email.flags,
    attachments: email.attachments,
    ...additionalMetadata,
  };
}
