import { attachmentsForMetadata } from './attachments_for_metadata';
import { NO_SUBJECT } from './constants';
import type { EmailType } from './types';

/**
 * Build rich metadata object for email message
 * Preserves both text and HTML content separately in metadata
 */
export function buildEmailMetadata(email: EmailType): Record<string, unknown> {
  return {
    from: email.from,
    to: email.to,
    cc: email.cc,
    bcc: email.bcc,
    receivedAt: email.date,
    sentAt: email.date,
    text: email.text ?? null,
    html: email.html ?? null,
    body: (email.html || email.text) ?? null,
    headers: email.headers,
    uid: email.uid ?? null,
    flags: email.flags,
    attachments: attachmentsForMetadata(email.attachments),
    subject: email.subject || NO_SUBJECT,
  };
}
