import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import type { BulkOperationResult } from './types';

import * as AuditLogHelpers from '../audit_logs/helpers';
import { buildAuditContext } from '../lib/helpers/build_audit_context';

export async function bulkSpamConversations(
  ctx: MutationCtx,
  args: {
    conversationIds: Array<Id<'conversations'>>;
  },
): Promise<BulkOperationResult> {
  const conversations = await Promise.all(
    args.conversationIds.map((id) => ctx.db.get(id)),
  );

  const patches: Array<{
    id: Id<'conversations'>;
    previousStatus: string | undefined;
  }> = [];
  const errors: string[] = [];

  for (let i = 0; i < args.conversationIds.length; i++) {
    const conversationId = args.conversationIds[i];
    const conversation = conversations[i];

    if (!conversation) {
      errors.push(`Conversation ${conversationId} not found`);
      continue;
    }

    patches.push({
      id: conversationId,
      previousStatus: conversation.status,
    });
  }

  const results = await Promise.allSettled(
    patches.map(({ id }) => ctx.db.patch(id, { status: 'spam' })),
  );

  let successCount = 0;
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled') {
      successCount++;
    } else {
      const reason = result.status === 'rejected' ? result.reason : undefined;
      errors.push(
        `Failed to mark ${patches[i].id} as spam: ${reason instanceof Error ? reason.message : 'Unknown error'}`,
      );
    }
  }

  const failedCount = args.conversationIds.length - successCount;

  const firstValidConversation = conversations.find((c) => c !== null);
  if (firstValidConversation) {
    await AuditLogHelpers.logSuccess(
      ctx,
      await buildAuditContext(ctx, firstValidConversation.organizationId),
      'bulk_spam_conversations',
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
