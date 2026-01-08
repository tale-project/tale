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

  // Collect message IDs first, then delete in parallel
  const messageIds: Id<'conversationMessages'>[] = [];
  const messagesQuery = ctx.db
    .query('conversationMessages')
    .withIndex('by_conversationId_and_deliveredAt', (q) =>
      q.eq('conversationId', conversationId),
    );
  for await (const msg of messagesQuery) {
    messageIds.push(msg._id);
  }
  await Promise.all(messageIds.map((id) => ctx.db.delete(id)));

  // Delete the conversation itself
  await ctx.db.delete(conversationId);
}
