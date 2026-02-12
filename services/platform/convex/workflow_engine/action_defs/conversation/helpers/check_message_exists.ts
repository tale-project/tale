import type { Id } from '../../../../_generated/dataModel';
import type { ActionCtx } from '../../../../_generated/server';

import { internal } from '../../../../_generated/api';

export interface ExistingMessage {
  _id: Id<'conversationMessages'>;
  _creationTime: number;
  organizationId: string;
  conversationId: Id<'conversations'>;
  channel: string;
  direction: 'inbound' | 'outbound';
  externalMessageId?: string;
  deliveryState: 'queued' | 'sent' | 'delivered' | 'failed';
  content: string;
  sentAt?: number;
  deliveredAt?: number;
  metadata?: unknown;
}

/**
 * Check if a message already exists by external message ID
 */
export async function checkMessageExists(
  ctx: ActionCtx,
  organizationId: string,
  externalMessageId: string,
): Promise<ExistingMessage | null> {
  return (await ctx.runQuery(
    internal.conversations.internal_queries.getMessageByExternalId,
    {
      organizationId,
      externalMessageId,
    },
  )) as ExistingMessage | null;
}
