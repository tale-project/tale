/**
 * Close a conversation (business logic)
 */

import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';

export async function closeConversation(
  ctx: MutationCtx,
  args: {
    conversationId: Id<'conversations'>;
    resolvedBy?: string;
  },
): Promise<void> {
  const conversation = await ctx.db.get(args.conversationId);
  if (!conversation) {
    throw new Error('Conversation not found');
  }

  const existingMetadata = conversation.metadata || {};
  const patchMetadata = {
    ...existingMetadata,
    resolved_at: new Date().toISOString(),
    ...(args.resolvedBy ? { resolved_by: args.resolvedBy } : {}),
  };

  await ctx.db.patch(args.conversationId, {
    status: 'closed',
    metadata: patchMetadata,
  });
}

