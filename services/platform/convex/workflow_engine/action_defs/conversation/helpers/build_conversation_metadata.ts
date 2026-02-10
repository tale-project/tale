import type { ConvexJsonRecord } from '../../../../../lib/shared/schemas/utils/json-value';
import type { EmailType } from './types';

import { toConvexJsonRecord } from '../../../../lib/type_cast_helpers';

/**
 * Build conversation metadata object
 */
export function buildConversationMetadata(
  email: EmailType,
  additionalMetadata?: Record<string, unknown>,
): ConvexJsonRecord {
  return toConvexJsonRecord({
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
    attachments: email.attachments,
    ...additionalMetadata,
  });
}
