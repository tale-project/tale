import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import * as AuditLogHelpers from '../audit_logs/helpers';
import { buildAuditContext } from '../lib/helpers/build_audit_context';

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

  await AuditLogHelpers.logSuccess(
    ctx,
    await buildAuditContext(ctx, conversation.organizationId),
    'close_conversation',
    'data',
    'conversation',
    String(args.conversationId),
    conversation.subject,
    { status: previousStatus },
    { status: 'closed', resolvedBy: args.resolvedBy },
  );
}
