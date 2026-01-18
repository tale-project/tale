/**
 * Create a new conversation (business logic)
 */

import type { MutationCtx } from '../_generated/server';
import type { CreateConversationArgs } from './types';

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata: args.metadata as any,
  });

  return {
    success: true,
    conversationId,
  };
}
