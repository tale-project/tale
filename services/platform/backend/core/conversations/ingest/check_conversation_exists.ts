import type { ActionCtx } from '../../lib/ctx';
import { internal } from '../../lib/handler_names';
import type { Id } from '../../lib/rows';
import { normalizeExternalMessageId } from './normalize_external_message_id';

/**
 * Check if a conversation exists by external message ID
 */
export async function checkConversationExists(
  ctx: ActionCtx,
  organizationId: string,
  externalMessageId: string,
): Promise<{
  _id: Id<'conversations'>;
  metadata?: unknown;
  direction?: 'inbound' | 'outbound';
} | null> {
  const normalized = normalizeExternalMessageId(externalMessageId);
  if (!normalized) return null;

  return await ctx.runQuery(
    internal.conversations.internal_queries.getConversationByExternalMessageId,
    {
      organizationId,
      externalMessageId: normalized,
    },
  );
}
