import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import type { ConversationStatus, ConversationPriority } from './types';

import * as AuditLogHelpers from '../audit_logs/helpers';
import { buildAuditContext } from '../lib/helpers/build_audit_context';

const UPDATABLE_FIELDS = ['subject', 'status', 'priority', 'type'] as const;

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
  const updateData: Record<string, unknown> = {};
  const newState: Record<string, unknown> = {};

  for (const field of UPDATABLE_FIELDS) {
    if (args[field] !== undefined) {
      previousState[field] = conversation[field];
      updateData[field] = args[field];
      newState[field] = args[field];
    }
  }

  if (args.metadata !== undefined) {
    const existingMetadata = conversation.metadata ?? {};
    updateData.metadata = {
      ...existingMetadata,
      ...(typeof args.metadata === 'object' &&
      args.metadata !== null &&
      !Array.isArray(args.metadata)
        ? args.metadata
        : {}),
    };
  }

  await ctx.db.patch(args.conversationId, updateData);

  await AuditLogHelpers.logSuccess(
    ctx,
    await buildAuditContext(ctx, conversation.organizationId),
    'update_conversation',
    'data',
    'conversation',
    String(args.conversationId),
    conversation.subject,
    previousState,
    newState,
  );
}
