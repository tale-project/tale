/**
 * Get conversation by external message ID
 */

import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

export async function getConversationByExternalMessageId(
  ctx: QueryCtx,
  organizationId: string,
  externalMessageId: string,
): Promise<Doc<'conversations'> | null> {
  const conversation = await ctx.db
    .query('conversations')
    .withIndex('by_organizationId_and_externalMessageId', (q) =>
      q
        .eq('organizationId', organizationId)
        .eq('externalMessageId', externalMessageId),
    )
    .unique();

  return conversation;
}
