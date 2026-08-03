import type { Id } from '../../_generated/dataModel';
import type { ActionCtx } from '../../_generated/server';
import { resolveEmailConversationTarget } from './resolve_email_conversation_target';
import type { EmailType } from './types';

/**
 * Find related conversation by In-Reply-To or References headers.
 */
export async function findRelatedConversation(
  ctx: ActionCtx,
  organizationId: string,
  email: EmailType,
): Promise<Id<'conversations'> | null> {
  return resolveEmailConversationTarget(ctx, organizationId, email);
}
