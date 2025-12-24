/**
 * Bulk reopen conversations (business logic)
 */

import type { MutationCtx } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';
import type { BulkOperationResult } from './types';

export async function bulkReopenConversations(
  ctx: MutationCtx,
  conversationIds: Array<Id<'conversations'>>,
): Promise<BulkOperationResult> {
  let successCount = 0;
  let failedCount = 0;
  const errors: string[] = [];

  for (const conversationId of conversationIds) {
    try {
      const conversation = await ctx.db.get(conversationId);
      if (!conversation) {
        failedCount++;
        errors.push(`Conversation ${conversationId} not found`);
        continue;
      }

      const metadata = (conversation.metadata as Record<string, unknown>) || {};
      const { _resolved_at, _resolved_by, ...restMetadata } = metadata;

      await ctx.db.patch(conversationId, {
        status: 'open',
        metadata: restMetadata,
      });
      successCount++;
    } catch (error) {
      failedCount++;
      errors.push(
        `Failed to reopen ${conversationId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  return { successCount, failedCount, errors };
}
