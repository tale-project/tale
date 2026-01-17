import type { ActionCtx } from '../../../../_generated/server';
import { internal } from '../../../../_generated/api';
import type { Id } from '../../../../_generated/dataModel';

/**
 * Check if a conversation exists by external message ID
 */
export async function checkConversationExists(
  ctx: ActionCtx,
  organizationId: string,
  externalMessageId: string,
): Promise<{ _id: Id<'conversations'>; metadata?: unknown } | null> {
  return (await ctx.runQuery(
    internal.conversations.getConversationByExternalMessageId,
    {
      organizationId,
      externalMessageId,
    },
  )) as { _id: Id<'conversations'>; metadata?: unknown } | null;
}
