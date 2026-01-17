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
  // Batch fetch all conversations in parallel
  const conversations = await Promise.all(
    args.conversationIds.map((id) => ctx.db.get(id)),
  );

  // Build patches for valid conversations
  const patches: Array<{
    id: Id<'conversations'>;
    patch: Record<string, unknown>;
  }> = [];
  const errors: string[] = [];

  for (let i = 0; i < args.conversationIds.length; i++) {
    const conversationId = args.conversationIds[i];
    const conversation = conversations[i];

    if (!conversation) {
      errors.push(`Conversation ${conversationId} not found`);
      continue;
    }

    const existingMetadata =
      (conversation.metadata as Record<string, unknown>) || {};
    patches.push({
      id: conversationId,
      patch: {
        status: 'closed',
        metadata: {
          ...existingMetadata,
          resolved_at: new Date().toISOString(),
          resolved_by: args.resolvedBy,
        },
      },
    });
  }

  // Apply all patches in parallel
  const results = await Promise.allSettled(
    patches.map(({ id, patch }) => ctx.db.patch(id, patch)),
  );

  // Count successes and failures from patch results
  let successCount = 0;
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled') {
      successCount++;
    } else {
      errors.push(
        `Failed to close ${patches[i].id}: ${result.reason instanceof Error ? result.reason.message : 'Unknown error'}`,
      );
    }
  }

  return {
    successCount,
    failedCount: args.conversationIds.length - successCount,
    errors,
  };
}
