import { AppError } from '../../lib/shared/errors/app-error';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { emitAuditSuccess } from '../audit_logs/emit';
import { buildAuditContext } from '../lib/helpers/build_audit_context';

export async function markConversationAsSpam(
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

  await ctx.db.patch(args.conversationId, { status: 'spam' });

  await emitAuditSuccess(ctx, {
    auditCtx: await buildAuditContext(ctx, conversation.organizationId),
    action: 'mark_conversation_as_spam',
    category: 'data',
    resourceType: 'conversation',
    resourceId: String(args.conversationId),
    resourceName: conversation.subject,
    previousState: { status: previousStatus },
    newState: { status: 'spam' },
  });
}
