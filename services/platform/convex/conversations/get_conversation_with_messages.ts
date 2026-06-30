/**
 * Get a conversation with all its messages (business logic)
 */

import type { Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { isActiveOrg } from '../lib/rls/organization/assert_active_org';
import { transformConversation } from './transform_conversation';
import type { ConversationItem } from './types';

export async function getConversationWithMessages(
  ctx: QueryCtx,
  conversationId: Id<'conversations'>,
  activeOrgId: string,
): Promise<ConversationItem | null> {
  const conversation = await ctx.db.get(conversationId);
  // Active-org coherence: deny a conversation carried over from another org.
  if (!conversation || !isActiveOrg(conversation.organizationId, activeOrgId)) {
    return null;
  }
  return await transformConversation(ctx, conversation, {
    includeAllMessages: true,
  });
}
