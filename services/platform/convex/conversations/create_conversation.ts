/**
 * Create a new conversation (business logic)
 */

import type { MutationCtx } from '../_generated/server';
import type { CreateConversationArgs } from './types';
import * as AuditLogHelpers from '../audit_logs/helpers';

export async function createConversation(
  ctx: MutationCtx,
  args: CreateConversationArgs,
) {
  const conversationId = await ctx.db.insert('conversations', {
    organizationId: args.organizationId,
    customerId: args.customerId,
    externalMessageId: args.externalMessageId,
    subject: args.subject,
    status: args.status,
    priority: args.priority,
    type: args.type,
    channel: args.channel,
    direction: args.direction,
    providerId: args.providerId,
    metadata: args.metadata as any,
  });

  await AuditLogHelpers.logSuccess(
    ctx,
    {
      organizationId: args.organizationId,
      actor: { id: 'system', type: 'system' as const },
    },
    'create_conversation',
    'data',
    'conversation',
    String(conversationId),
    args.subject,
    undefined,
    {
      channel: args.channel,
      direction: args.direction,
      status: args.status ?? 'open',
      priority: args.priority ?? 'medium',
    },
  );

  return {
    success: true,
    conversationId,
  };
}
