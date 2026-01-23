/**
 * Update a conversation (business logic)
 */

import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import type { ConversationStatus, ConversationPriority } from './types';
import * as AuditLogHelpers from '../audit_logs/helpers';
import { getAuthenticatedUser } from '../lib/rls/auth/get_authenticated_user';

export async function updateConversation(
  ctx: MutationCtx,
  args: {
    conversationId: Id<'conversations'>;
    subject?: string;
    status?: ConversationStatus;
    priority?: ConversationPriority;
    type?: string;
    metadata?: unknown;
  },
): Promise<void> {
  const conversation = await ctx.db.get(args.conversationId);
  if (!conversation) {
    throw new Error('Conversation not found');
  }

  const previousState: Record<string, unknown> = {};
  if (args.subject !== undefined) previousState.subject = conversation.subject;
  if (args.status !== undefined) previousState.status = conversation.status;
  if (args.priority !== undefined) previousState.priority = conversation.priority;
  if (args.type !== undefined) previousState.type = conversation.type;

  // Build update object with only provided fields
  const updateData: Record<string, unknown> = {};
  if (args.subject !== undefined) updateData.subject = args.subject;
  if (args.status !== undefined) updateData.status = args.status;
  if (args.priority !== undefined) updateData.priority = args.priority;
  if (args.type !== undefined) updateData.type = args.type;
  if (args.metadata !== undefined) {
    // Merge metadata to preserve existing fields
    const existingMetadata =
      (conversation.metadata as Record<string, unknown>) || {};
    updateData.metadata = {
      ...existingMetadata,
      ...(args.metadata as Record<string, unknown>),
    };
  }

  await ctx.db.patch(args.conversationId, updateData);

  const newState: Record<string, unknown> = {};
  if (args.subject !== undefined) newState.subject = args.subject;
  if (args.status !== undefined) newState.status = args.status;
  if (args.priority !== undefined) newState.priority = args.priority;
  if (args.type !== undefined) newState.type = args.type;

  const authUser = await getAuthenticatedUser(ctx);
  await AuditLogHelpers.logSuccess(
    ctx,
    {
      organizationId: conversation.organizationId,
      actor: authUser
        ? { id: authUser.userId, email: authUser.email, type: 'user' as const }
        : { id: 'system', type: 'system' as const },
    },
    'update_conversation',
    'data',
    'conversation',
    String(args.conversationId),
    conversation.subject,
    previousState,
    newState,
  );
}
