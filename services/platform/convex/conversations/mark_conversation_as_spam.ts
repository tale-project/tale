/**
 * Mark a conversation as spam (business logic)
 */

import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import * as AuditLogHelpers from '../audit_logs/helpers';
import { getAuthenticatedUser } from '../lib/rls/auth/get_authenticated_user';

export async function markConversationAsSpam(
  ctx: MutationCtx,
  conversationId: Id<'conversations'>,
): Promise<void> {
  const conversation = await ctx.db.get(conversationId);
  if (!conversation) {
    throw new Error('Conversation not found');
  }

  const previousStatus = conversation.status;

  await ctx.db.patch(conversationId, {
    status: 'spam',
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
    'mark_conversation_as_spam',
    'data',
    'conversation',
    String(conversationId),
    conversation.subject,
    { status: previousStatus },
    { status: 'spam' },
  );
}

