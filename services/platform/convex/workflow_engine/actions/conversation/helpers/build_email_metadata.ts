import type { EmailType } from './types';
import type { ConvexJsonRecord } from '../../../../../lib/shared/schemas/utils/json-value';

/**
 * Build rich metadata object for email message
 * Preserves both text and HTML content separately in metadata
 */
export function buildEmailMetadata(email: EmailType): ConvexJsonRecord {
  return {
    from: email.from as ConvexJsonRecord[string],
    to: email.to as ConvexJsonRecord[string],
    cc: email.cc as ConvexJsonRecord[string],
    bcc: email.bcc as ConvexJsonRecord[string],
    receivedAt: email.date,
    sentAt: email.date,
    text: email.text ?? null, // Preserve plain text content
    html: email.html ?? null, // Preserve raw HTML content
    body: (email.html || email.text) ?? null, // Prioritize raw HTML content, fallback to text
    headers: email.headers as ConvexJsonRecord[string],
    uid: email.uid ?? null,
    flags: email.flags as ConvexJsonRecord[string],
    attachments: email.attachments as ConvexJsonRecord[string],
    subject: email.subject || '(no subject)',
  };
}
