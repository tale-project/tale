/**
 * Reopen a conversation (business logic)
 */

import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';

export async function reopenConversation(
  ctx: MutationCtx,
  conversationId: Id<'conversations'>,
): Promise<void> {
  const conversation = await ctx.db.get(conversationId);
  if (!conversation) {
    throw new Error('Conversation not found');
  }

  const metadata = (conversation.metadata as Record<string, unknown>) || {};
  const { _resolved_at, _resolved_by, ...restMetadata } = metadata;

  await ctx.db.patch(conversationId, {
    status: 'open',
    metadata: restMetadata,
  });
}
