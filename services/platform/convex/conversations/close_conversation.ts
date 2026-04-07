import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

import * as AuditLogHelpers from '../audit_logs/helpers';
import { buildAuditContext } from '../lib/helpers/build_audit_context';
import { emitEvent } from '../workflows/triggers/emit_event';

export async function closeConversation(
  ctx: MutationCtx,
  args: {
    conversationId: Id<'conversations'>;
    resolvedBy?: string;
  },
): Promise<void> {
  const conversation = await ctx.db.get(args.conversationId);
  if (!conversation) {
    throw new Error('Conversation not found');
  }

  const previousStatus = conversation.status;

  const existingMetadata = conversation.metadata || {};
  await ctx.db.patch(args.conversationId, {
    status: 'closed',
    metadata: {
      ...existingMetadata,
      resolved_at: new Date().toISOString(),
      ...(args.resolvedBy ? { resolved_by: args.resolvedBy } : {}),
    },
  });

  await AuditLogHelpers.logSuccess(ctx, {
    auditCtx: await buildAuditContext(ctx, conversation.organizationId),
    action: 'close_conversation',
    category: 'data',
    resourceType: 'conversation',
    resourceId: String(args.conversationId),
    resourceName: conversation.subject,
    previousState: { status: previousStatus },
    newState: { status: 'closed', resolvedBy: args.resolvedBy },
  });

  const updatedConversation = await ctx.db.get(args.conversationId);
  if (updatedConversation) {
    await emitEvent(ctx, {
      organizationId: conversation.organizationId,
      eventType: 'conversation.closed',
      eventData: { conversation: updatedConversation, previousStatus },
    });
  }
}
