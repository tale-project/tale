/**
 * Mark a conversation as read (business logic)
 */

import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import * as AuditLogHelpers from '../audit_logs/helpers';
import { getAuthenticatedUser } from '../lib/rls/auth/get_authenticated_user';

export async function markConversationAsRead(
  ctx: MutationCtx,
  conversationId: Id<'conversations'>,
): Promise<void> {
  const conversation = await ctx.db.get(conversationId);
  if (!conversation) {
    throw new Error('Conversation not found');
  }

  const existingMetadata =
    (conversation.metadata as Record<string, unknown>) || {};
  const previousUnreadCount = (existingMetadata.unread_count as number) || 0;

  await ctx.db.patch(conversationId, {
    metadata: {
      ...existingMetadata,
      last_read_at: new Date().toISOString(),
      unread_count: 0,
    },
  });

  const authUser = await getAuthenticatedUser(ctx);
  await AuditLogHelpers.logSuccess(
    ctx,
    {
      organizationId: conversation.organizationId,
      actor: authUser
        ? { id: authUser.userId, email: authUser.email, type: 'user' as const }
        : { id: 'system', type: 'system' as const },
    },
    'mark_conversation_as_read',
    'data',
    'conversation',
    String(conversationId),
    conversation.subject,
    { unreadCount: previousUnreadCount },
    { unreadCount: 0 },
  );
}

