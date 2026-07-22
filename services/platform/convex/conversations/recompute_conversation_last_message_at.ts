/**
 * After deleting a conversation message, walk `lastMessageAt` back to the
 * remaining latest message so the inbox list doesn't keep sorting/labelling by
 * a row that no longer exists.
 */

import { nextConversationLastMessageAt } from '../../lib/shared/conversations/message-order';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

export async function recomputeConversationLastMessageAt(
  ctx: MutationCtx,
  conversationId: Id<'conversations'>,
): Promise<void> {
  const conversation = await ctx.db.get(conversationId);
  if (!conversation) return;

  const remaining = await ctx.db
    .query('conversationMessages')
    .withIndex('by_conversationId_and_deliveredAt', (q) =>
      q.eq('conversationId', conversationId),
    )
    .collect();

  let lastMessageAt: number | undefined;
  for (const row of remaining) {
    lastMessageAt = nextConversationLastMessageAt(lastMessageAt, row);
  }
  lastMessageAt ??= conversation._creationTime;

  const existingMetadata = conversation.metadata ?? {};
  await ctx.db.patch(conversationId, {
    lastMessageAt,
    metadata: {
      ...existingMetadata,
      last_message_at: lastMessageAt,
    },
  });
}
