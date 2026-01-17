/**
 * Mark a conversation as read (business logic)
 */

import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';

export async function markConversationAsRead(
  ctx: MutationCtx,
  conversationId: Id<'conversations'>,
): Promise<void> {
  const conversation = await ctx.db.get(conversationId);
  if (!conversation) {
    throw new Error('Conversation not found');
  }

  const existingMetadata =
    (conversation.metadata as Record<string, unknown>) || {};
  await ctx.db.patch(conversationId, {
    metadata: {
      ...existingMetadata,
      last_read_at: new Date().toISOString(),
      unread_count: 0,
    },
  });
}

