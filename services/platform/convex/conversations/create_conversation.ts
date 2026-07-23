/**
 * Create a new conversation (business logic)
 */

import type { MutationCtx } from '../_generated/server';
import * as AuditLogHelpers from '../audit_logs/helpers';
import { emitEvent } from '../events/emit';
import { toConvexJsonRecord } from '../lib/type_cast_helpers';
import type { CreateConversationArgs } from './types';

export async function createConversation(
  ctx: MutationCtx,
  args: CreateConversationArgs,
) {
  const conversationId = await ctx.db.insert('conversations', {
    organizationId: args.organizationId,
    contactId: args.contactId,
    assigneeUserId: args.assigneeUserId,
    externalMessageId: args.externalMessageId,
    subject: args.subject,
    status: args.status,
    priority: args.priority,
    type: args.type,
    channel: args.channel,
    direction: args.direction,
    integrationName: args.integrationName,
    metadata: toConvexJsonRecord(args.metadata),
  });

  await AuditLogHelpers.logSuccess(ctx, {
    auditCtx: {
      organizationId: args.organizationId,
      actor: { id: 'system', type: 'system' as const },
    },
    action: 'create_conversation',
    category: 'data',
    resourceType: 'conversation',
    resourceId: String(conversationId),
    resourceName: args.subject,
    newState: {
      channel: args.channel,
      direction: args.direction,
      status: args.status ?? 'open',
      priority: args.priority ?? 'medium',
    },
  });

  const conversation = await ctx.db.get(conversationId);
  if (conversation) {
    await emitEvent(ctx, {
      organizationId: args.organizationId,
      eventType: 'conversation.created',
      eventData: { conversation },
    });
  }

  return {
    success: true,
    conversationId,
  };
}
