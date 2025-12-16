/**
 * Query conversation messages with flexible filtering and pagination support (business logic)
 */

import type { QueryCtx } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';

export interface QueryConversationMessagesArgs {
  organizationId: string;
  conversationId?: Id<'conversations'>;
  channel?: string;
  direction?: 'inbound' | 'outbound';
  paginationOpts: {
    numItems: number;
    cursor: string | null;
  };
}

export interface QueryConversationMessagesResult {
  items: Array<{
    _id: Id<'conversationMessages'>;
    _creationTime: number;
    organizationId: string;
    conversationId: Id<'conversations'>;
    providerId?: Id<'emailProviders'>;
    channel: string;
    direction: 'inbound' | 'outbound';
    externalMessageId?: string;
    deliveryState: 'queued' | 'sent' | 'delivered' | 'failed';
    content: string;
    sentAt?: number;
    deliveredAt?: number;
    metadata?: unknown;
  }>;
  isDone: boolean;
  continueCursor: string | null;
  count: number;
}

export async function queryConversationMessages(
  ctx: QueryCtx,
  args: QueryConversationMessagesArgs,
): Promise<QueryConversationMessagesResult> {
  const numItems = args.paginationOpts.numItems;

  // Choose the best index based on provided filters
  // Priority: conversationId > (organizationId + channel + direction) > organizationId
  let query;

  if (args.conversationId !== undefined) {
    // Use conversationId + deliveredAt index for best performance when filtering by specific conversation
    query = ctx.db
      .query('conversationMessages')
      .withIndex('by_conversationId_and_deliveredAt', (q) =>
        q.eq('conversationId', args.conversationId!),
      )
      .order('asc');
  } else if (args.channel !== undefined && args.direction !== undefined) {
    // Use the combined index with deliveredAt for efficient filtering by org + channel + direction
    query = ctx.db
      .query('conversationMessages')
      .withIndex('by_org_channel_direction_deliveredAt', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('channel', args.channel!)
          .eq('direction', args.direction!),
      );
  } else {
    // Default to organizationId + deliveredAt index
    query = ctx.db
      .query('conversationMessages')
      .withIndex('by_organizationId_and_deliveredAt', (q) =>
        q.eq('organizationId', args.organizationId),
      );
  }

  // Collect all matching messages
  const allMessages = await query.collect();

  // Apply additional filters that can't be handled by indexes
  let filteredMessages = allMessages;

  // Filter by channel if not already handled by index
  if (args.channel !== undefined && args.conversationId !== undefined) {
    filteredMessages = filteredMessages.filter(
      (msg) => msg.channel === args.channel,
    );
  }

  // Filter by direction if not already handled by index
  if (args.direction !== undefined && args.conversationId !== undefined) {
    filteredMessages = filteredMessages.filter(
      (msg) => msg.direction === args.direction,
    );
  }

  // Sort by deliveredAt (oldest first) for consistent pagination
  // Fall back to _creationTime if deliveredAt is not set
  filteredMessages.sort((a, b) => {
    const aTime = a.deliveredAt ?? a._creationTime;
    const bTime = b.deliveredAt ?? b._creationTime;
    return aTime - bTime;
  });

  // Apply cursor-based pagination
  const paginationOpts = args.paginationOpts;
  const startIndex = paginationOpts.cursor
    ? filteredMessages.findIndex((m) => m._id === paginationOpts.cursor) + 1
    : 0;
  const endIndex = startIndex + numItems;
  const paginatedMessages = filteredMessages.slice(startIndex, endIndex);

  return {
    items: paginatedMessages,
    isDone: endIndex >= filteredMessages.length,
    continueCursor:
      paginatedMessages.length > 0
        ? paginatedMessages[paginatedMessages.length - 1]._id
        : null,
    count: paginatedMessages.length,
  };
}
