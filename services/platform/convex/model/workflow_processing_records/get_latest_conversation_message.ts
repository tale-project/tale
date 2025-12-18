/**
 * Get the latest message for a conversation.
 *
 * This is a helper for the common pattern of checking the direction of the latest message
 * when finding unprocessed conversations.
 *
 * @example
 * ```typescript
 * // Query open conversations
 * for await (const conv of ctx.db
 *   .query('conversations')
 *   .withIndex('by_organizationId_and_status', q =>
 *     q.eq('organizationId', orgId).eq('status', 'open')
 *   )
 * ) {
 *   const isProcessed = await isDocumentProcessed(ctx, {...});
 *   if (isProcessed) continue;
 *
 *   // Check latest message direction
 *   const latestMsg = await getLatestConversationMessage(ctx, conv._id);
 *   if (latestMsg?.direction === 'inbound') {
 *     return conv; // Found an open conversation with inbound message
 *   }
 * }
 * ```
 */

import { QueryCtx } from '../../_generated/server';
import { Id, Doc } from '../../_generated/dataModel';

export async function getLatestConversationMessage(
  ctx: QueryCtx,
  conversationId: Id<'conversations'>,
): Promise<Doc<'conversationMessages'> | null> {
  const latestMessage = await ctx.db
    .query('conversationMessages')
    .withIndex('by_conversationId_and_deliveredAt', (q) =>
      q.eq('conversationId', conversationId),
    )
    .order('desc')
    .first();

  return latestMessage ?? null;
}

