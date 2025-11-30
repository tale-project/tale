/**
 * Bulk close conversations (business logic)
 */

import type { MutationCtx } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';
import type { BulkOperationResult } from './types';

export async function bulkCloseConversations(
  ctx: MutationCtx,
  args: {
    conversationIds: Array<Id<'conversations'>>;
    resolvedBy?: string;
  },
): Promise<BulkOperationResult> {
  let successCount = 0;
  let failedCount = 0;
  const errors: string[] = [];

  for (const conversationId of args.conversationIds) {
    try {
      const conversation = await ctx.db.get(conversationId);
      if (!conversation) {
        failedCount++;
        errors.push(`Conversation ${conversationId} not found`);
        continue;
      }

      const existingMetadata =
        (conversation.metadata as Record<string, unknown>) || {};
      await ctx.db.patch(conversationId, {
        status: 'closed',
        metadata: {
          ...existingMetadata,
          resolved_at: new Date().toISOString(),
          resolved_by: args.resolvedBy,
        },
      });
      successCount++;
    } catch (error) {
      failedCount++;
      errors.push(
        `Failed to close ${conversationId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  return { successCount, failedCount, errors };
}
