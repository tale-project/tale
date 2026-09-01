import type { EmailType } from './types';

/**
 * Drop transient wire fields (base64 bodies) before metadata or message rows
 * land in Convex.
 */
export function attachmentsForMetadata(
  attachments: EmailType['attachments'],
): EmailType['attachments'] {
  if (!attachments) return attachments;
  return attachments.map(({ contentBase64: _drop, ...rest }) => rest);
}
