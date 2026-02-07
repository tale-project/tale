import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import * as AuditLogHelpers from '../audit_logs/helpers';
import { buildAuditContext } from '../lib/helpers/build_audit_context';

export async function reopenConversation(
  ctx: MutationCtx,
  args: { conversationId: Id<'conversations'> },
): Promise<void> {
  const conversation = await ctx.db.get(args.conversationId);
  if (!conversation) {
    throw new Error('Conversation not found');
  }

  const previousStatus = conversation.status;

  const metadata =
    (conversation.metadata as Record<string, unknown>) || {};
  const { resolved_at: _, resolved_by: __, ...restMetadata } = metadata;

  await ctx.db.patch(args.conversationId, {
    status: 'open',
    metadata: restMetadata,
  });

  await AuditLogHelpers.logSuccess(
    ctx,
    await buildAuditContext(ctx, conversation.organizationId),
    'reopen_conversation',
    'data',
    'conversation',
    String(args.conversationId),
    conversation.subject,
    { status: previousStatus },
    { status: 'open' },
  );
}
