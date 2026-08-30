import { AppError } from '../../lib/shared/errors/app-error';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { emitAuditSuccess } from '../audit_logs/emit';
import { buildAuditContext } from '../lib/helpers/build_audit_context';

export async function reopenConversation(
  ctx: MutationCtx,
  args: { conversationId: Id<'conversations'> },
): Promise<void> {
  const conversation = await ctx.db.get(args.conversationId);
  if (!conversation) {
    throw new AppError({
      code: 'conversation_not_found',
      message: 'Conversation not found',
    });
  }

  const previousStatus = conversation.status;

  const metadata = conversation.metadata ?? {};
  const { resolved_at: _, resolved_by: __, ...restMetadata } = metadata;

  await ctx.db.patch(args.conversationId, {
    status: 'open',
    metadata: restMetadata,
  });

  await emitAuditSuccess(ctx, {
    auditCtx: await buildAuditContext(ctx, conversation.organizationId),
    action: 'reopen_conversation',
    category: 'data',
    resourceType: 'conversation',
    resourceId: String(args.conversationId),
    resourceName: conversation.subject,
    previousState: { status: previousStatus },
    newState: { status: 'open' },
  });
}
