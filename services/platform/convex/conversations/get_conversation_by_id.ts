/**
 * Get a conversation by ID (business logic)
 */

import type { Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

export async function getConversationById(
  ctx: QueryCtx,
  conversationId: Id<'conversations'>,
) {
  return await ctx.db.get(conversationId);
}
