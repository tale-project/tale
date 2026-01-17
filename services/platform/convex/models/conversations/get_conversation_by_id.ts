/**
 * Get a conversation by ID (business logic)
 */

import type { QueryCtx } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';

export async function getConversationById(
  ctx: QueryCtx,
  conversationId: Id<'conversations'>,
) {
  return await ctx.db.get(conversationId);
}
