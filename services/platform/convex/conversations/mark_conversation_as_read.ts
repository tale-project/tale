import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

import * as AuditLogHelpers from '../audit_logs/helpers';
import { buildAuditContext } from '../lib/helpers/build_audit_context';

export async function markConversationAsRead(
  ctx: MutationCtx,
  args: { conversationId: Id<'conversations'> },
): Promise<void> {
  const conversation = await ctx.db.get(args.conversationId);
  if (!conversation) {
    throw new Error('Conversation not found');
  }

  const existingMetadata = conversation.metadata ?? {};
  const previousUnreadCount =
    typeof existingMetadata.unread_count === 'number'
      ? existingMetadata.unread_count
      : 0;

  await ctx.db.patch(args.conversationId, {
    metadata: {
      ...existingMetadata,
      last_read_at: new Date().toISOString(),
      unread_count: 0,
    },
  });

  await AuditLogHelpers.logSuccess(
    ctx,
    await buildAuditContext(ctx, conversation.organizationId),
    'mark_conversation_as_read',
    'data',
    'conversation',
    String(args.conversationId),
    conversation.subject,
    { unreadCount: previousUnreadCount },
    { unreadCount: 0 },
  );
}
