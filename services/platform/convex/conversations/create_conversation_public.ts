/**
 * Create a new conversation (public API business logic)
 */

import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { toConvexJsonRecord } from '../lib/type_cast_helpers';
import type { ConversationStatus, ConversationPriority } from './types';

export async function createConversationPublic(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    contactId?: Id<'contacts'>;
    externalMessageId?: string;
    subject?: string;
    status?: ConversationStatus;
    priority?: ConversationPriority;
    type?: string;
    direction?: 'inbound' | 'outbound';
    metadata?: unknown;
  },
): Promise<Id<'conversations'>> {
  const conversationId = await ctx.db.insert('conversations', {
    organizationId: args.organizationId,
    contactId: args.contactId,
    externalMessageId: args.externalMessageId,
    subject: args.subject,
    status: args.status ?? 'open',
    priority: args.priority,
    type: args.type || 'general',
    direction: args.direction,

    metadata: toConvexJsonRecord(args.metadata || {}),
  });

  return conversationId;
}
