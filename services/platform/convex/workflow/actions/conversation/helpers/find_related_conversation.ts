import type { ActionCtx } from '../../../../_generated/server';
import type { Id } from '../../../../_generated/dataModel';
import type { EmailType } from '../types';
import { checkMessageExists } from './check_message_exists';

/**
 * Find related conversation by In-Reply-To or References headers
 */
export async function findRelatedConversation(
  ctx: ActionCtx,
  organizationId: string,
  email: EmailType,
): Promise<Id<'conversations'> | null> {
  if (!email.headers) {
    return null;
  }

  const inReplyTo = email.headers['in-reply-to'];
  const references = email.headers['references'];
  const candidate =
    inReplyTo ||
    (references ? references.split(/[,,\s]+/).filter(Boolean)[0] : undefined);

  if (!candidate) {
    return null;
  }

  const conv = await checkMessageExists(ctx, organizationId, candidate);
  return conv?.conversationId || null;
}
