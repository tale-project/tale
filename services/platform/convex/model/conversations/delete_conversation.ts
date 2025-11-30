/**
 * Delete a conversation (business logic)
 */

import type { MutationCtx } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';

export async function deleteConversation(
  ctx: MutationCtx,
  conversationId: Id<'conversations'>,
): Promise<void> {
  const conversation = await ctx.db.get(conversationId);
  if (!conversation) {
    throw new Error('Conversation not found');
  }

  // Delete associated messages first
  const messagesQuery = ctx.db
    .query('conversationMessages')
    .withIndex('by_conversationId_and_deliveredAt', (q) =>
      q.eq('conversationId', conversationId),
    );
  for await (const msg of messagesQuery) {
    await ctx.db.delete(msg._id);
  }

  // Delete the conversation itself
  await ctx.db.delete(conversationId);
}
