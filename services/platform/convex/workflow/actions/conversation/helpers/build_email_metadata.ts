import type { EmailType } from './types';

/**
 * Build rich metadata object for email message
 * Preserves both text and HTML content separately in metadata
 */
export function buildEmailMetadata(email: EmailType) {
  return {
    from: email.from,
    to: email.to,
    cc: email.cc,
    bcc: email.bcc,
    receivedAt: email.date,
    sentAt: email.date,
    text: email.text, // Preserve plain text content
    html: email.html, // Preserve raw HTML content
    body: email.html || email.text, // Prioritize raw HTML content, fallback to text
    headers: email.headers,
    uid: email.uid,
    flags: email.flags,
    attachments: email.attachments,
    subject: email.subject || '(no subject)',
  };
}
