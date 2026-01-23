/**
 * Close a conversation (business logic)
 */

import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import * as AuditLogHelpers from '../audit_logs/helpers';
import { getAuthenticatedUser } from '../lib/rls/auth/get_authenticated_user';

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
  const patchMetadata = {
    ...existingMetadata,
    resolved_at: new Date().toISOString(),
    ...(args.resolvedBy ? { resolved_by: args.resolvedBy } : {}),
  };

  await ctx.db.patch(args.conversationId, {
    status: 'closed',
    metadata: patchMetadata,
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
    'close_conversation',
    'data',
    'conversation',
    String(args.conversationId),
    conversation.subject,
    { status: previousStatus },
    { status: 'closed', resolvedBy: args.resolvedBy },
  );
}

