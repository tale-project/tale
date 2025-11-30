/**
 * Get a conversation with all its messages (business logic)
 */

import type { QueryCtx } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';
import type { ConversationItem } from './types';
import { transformConversation } from './transform_conversation';

export async function getConversationWithMessages(
  ctx: QueryCtx,
  conversationId: Id<'conversations'>,
): Promise<ConversationItem | null> {
  const conversation = await ctx.db.get(conversationId);
  if (!conversation) return null;
  return await transformConversation(ctx, conversation);
}
