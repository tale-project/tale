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

  const metadata = conversation.metadata || {};
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { resolved_at: _resolved_at, resolved_by: _resolved_by, ...restMetadata } = metadata as Record<string, unknown>;

  await ctx.db.patch(conversationId, {
    status: 'open',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata: restMetadata as any,
  });
}
