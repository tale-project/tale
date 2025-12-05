/**
 * Create a new conversation (public API business logic)
 */

import type { MutationCtx } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';

export async function createConversationPublic(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    customerId?: Id<'customers'>;
    externalMessageId?: string;
    subject?: string;
    status?: string;
    priority?: string;
    type?: string;
    direction?: 'inbound' | 'outbound';
    metadata?: unknown;
  },
): Promise<Id<'conversations'>> {
  const conversationId = await ctx.db.insert('conversations', {
    organizationId: args.organizationId,
    customerId: args.customerId,
    externalMessageId: args.externalMessageId,
    subject: args.subject,
    status: (args.status as any) || 'open',
    priority: args.priority,
    type: args.type || 'general',
    direction: args.direction,

    metadata: args.metadata || {},
  });

  return conversationId;
}
