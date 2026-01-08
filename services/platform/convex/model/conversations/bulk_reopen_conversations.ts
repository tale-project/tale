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
  // Batch fetch all conversations in parallel
  const conversations = await Promise.all(
    conversationIds.map((id) => ctx.db.get(id)),
  );

  // Build patches for valid conversations
  const patches: Array<{
    id: Id<'conversations'>;
    patch: Record<string, unknown>;
  }> = [];
  const errors: string[] = [];

  for (let i = 0; i < conversationIds.length; i++) {
    const conversationId = conversationIds[i];
    const conversation = conversations[i];

    if (!conversation) {
      errors.push(`Conversation ${conversationId} not found`);
      continue;
    }

    const metadata = (conversation.metadata as Record<string, unknown>) || {};
    const { _resolved_at, _resolved_by, ...restMetadata } = metadata;

    patches.push({
      id: conversationId,
      patch: {
        status: 'open',
        metadata: restMetadata,
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
        `Failed to reopen ${patches[i].id}: ${result.reason instanceof Error ? result.reason.message : 'Unknown error'}`,
      );
    }
  }

  return {
    successCount,
    failedCount: conversationIds.length - successCount,
    errors,
  };
}
