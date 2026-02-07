import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import type { BulkOperationResult } from './types';
import * as AuditLogHelpers from '../audit_logs/helpers';
import { buildAuditContext } from '../lib/helpers/build_audit_context';

export async function bulkCloseConversations(
  ctx: MutationCtx,
  args: {
    conversationIds: Array<Id<'conversations'>>;
    resolvedBy?: string;
  },
): Promise<BulkOperationResult> {
  const conversations = await Promise.all(
    args.conversationIds.map((id) => ctx.db.get(id)),
  );

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

  const results = await Promise.allSettled(
    patches.map(({ id, patch }) => ctx.db.patch(id, patch)),
  );

  let successCount = 0;
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'fulfilled') {
      successCount++;
    } else {
      const reason = (results[i] as PromiseRejectedResult).reason;
      errors.push(
        `Failed to close ${patches[i].id}: ${reason instanceof Error ? reason.message : 'Unknown error'}`,
      );
    }
  }

  const failedCount = args.conversationIds.length - successCount;

  const firstValidConversation = conversations.find((c) => c !== null);
  if (firstValidConversation) {
    await AuditLogHelpers.logSuccess(
      ctx,
      await buildAuditContext(ctx, firstValidConversation.organizationId),
      'bulk_close_conversations',
      'data',
      'conversation',
      undefined,
      undefined,
      undefined,
      undefined,
      {
        conversationIds: args.conversationIds.map(String),
        count: args.conversationIds.length,
        successCount,
        failedCount,
      },
    );
  }

  return { successCount, failedCount, errors };
}
