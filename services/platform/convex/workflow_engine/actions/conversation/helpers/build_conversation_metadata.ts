import type { EmailType } from './types';
import type { ConvexJsonRecord } from '../../../../../lib/shared/schemas/utils/json-value';

/**
 * Build conversation metadata object
 */
export function buildConversationMetadata(
  email: EmailType,
  additionalMetadata?: Record<string, unknown>,
): ConvexJsonRecord {
  return {
    from: email.from as ConvexJsonRecord[string],
    to: email.to as ConvexJsonRecord[string],
    cc: email.cc as ConvexJsonRecord[string],
    bcc: email.bcc as ConvexJsonRecord[string],
    receivedAt: email.date,
    sentAt: email.date,
    body: (email.html || email.text) ?? null,
    headers: email.headers as ConvexJsonRecord[string],
    uid: email.uid ?? null,
    flags: email.flags as ConvexJsonRecord[string],
    attachments: email.attachments as ConvexJsonRecord[string],
    ...additionalMetadata,
  } as ConvexJsonRecord;
}
