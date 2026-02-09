import type { Id } from '../../../../_generated/dataModel';
import type { ActionCtx } from '../../../../_generated/server';
import type { EmailType } from './types';

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
    (references ? references.split(/[,,\s]+/).find(Boolean) : undefined);

  if (!candidate) {
    return null;
  }

  const conv = await checkMessageExists(ctx, organizationId, candidate);
  return conv?.conversationId || null;
}
