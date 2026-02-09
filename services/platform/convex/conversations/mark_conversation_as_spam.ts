import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

import * as AuditLogHelpers from '../audit_logs/helpers';
import { buildAuditContext } from '../lib/helpers/build_audit_context';

export async function markConversationAsSpam(
  ctx: MutationCtx,
  args: { conversationId: Id<'conversations'> },
): Promise<void> {
  const conversation = await ctx.db.get(args.conversationId);
  if (!conversation) {
    throw new Error('Conversation not found');
  }

  const previousStatus = conversation.status;

  await ctx.db.patch(args.conversationId, { status: 'spam' });

  await AuditLogHelpers.logSuccess(
    ctx,
    await buildAuditContext(ctx, conversation.organizationId),
    'mark_conversation_as_spam',
    'data',
    'conversation',
    String(args.conversationId),
    conversation.subject,
    { status: previousStatus },
    { status: 'spam' },
  );
}
