import type { ConvexJsonRecord } from '../../../../../lib/shared/schemas/utils/json-value';
import type { EmailType } from './types';

import { toConvexJsonRecord } from '../../../../lib/type_cast_helpers';

/**
 * Build rich metadata object for email message
 * Preserves both text and HTML content separately in metadata
 */
export function buildEmailMetadata(email: EmailType): ConvexJsonRecord {
  return toConvexJsonRecord({
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
    attachments: email.attachments,
    subject: email.subject || '(no subject)',
  });
}
