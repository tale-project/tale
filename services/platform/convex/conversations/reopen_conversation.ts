/**
 * Reopen a conversation (business logic)
 */

import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import * as AuditLogHelpers from '../audit_logs/helpers';
import { getAuthenticatedUser } from '../lib/rls/auth/get_authenticated_user';

export async function reopenConversation(
  ctx: MutationCtx,
  conversationId: Id<'conversations'>,
): Promise<void> {
  const conversation = await ctx.db.get(conversationId);
  if (!conversation) {
    throw new Error('Conversation not found');
  }

  const previousStatus = conversation.status;

  const metadata = conversation.metadata || {};
   
  const { resolved_at: _resolved_at, resolved_by: _resolved_by, ...restMetadata } = metadata as Record<string, unknown>;

  await ctx.db.patch(conversationId, {
    status: 'open',
     
    metadata: restMetadata as any,
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
    'reopen_conversation',
    'data',
    'conversation',
    String(conversationId),
    conversation.subject,
    { status: previousStatus },
    { status: 'open' },
  );
}
