/**
 * Query conversation messages with flexible filtering and pagination support (business logic)
 *
 * Optimized to use async iteration with early termination for pagination.
 * The indexes include deliveredAt so ordering is handled by the database.
 */

import type { QueryCtx } from '../../_generated/server';
import type { Id, Doc } from '../../_generated/dataModel';

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
  const cursor = args.paginationOpts.cursor;

  // Choose the best index based on provided filters
  // Priority: conversationId > (organizationId + channel + direction) > organizationId
  // All indexes include deliveredAt for ordering
  let query;
  let indexUsed: 'conversationId' | 'org_channel_direction' | 'organizationId';

  if (args.conversationId !== undefined) {
    // Use conversationId + deliveredAt index for specific conversation
    query = ctx.db
      .query('conversationMessages')
      .withIndex('by_conversationId_and_deliveredAt', (q) =>
        q.eq('conversationId', args.conversationId!),
      )
      .order('asc');
    indexUsed = 'conversationId';
  } else if (args.channel !== undefined && args.direction !== undefined) {
    // Use the combined index for org + channel + direction
    query = ctx.db
      .query('conversationMessages')
      .withIndex('by_org_channel_direction_deliveredAt', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('channel', args.channel!)
          .eq('direction', args.direction!),
      )
      .order('asc');
    indexUsed = 'org_channel_direction';
  } else {
    // Default to organizationId + deliveredAt index
    query = ctx.db
      .query('conversationMessages')
      .withIndex('by_organizationId_and_deliveredAt', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .order('asc');
    indexUsed = 'organizationId';
  }

  // Use async iteration with early termination
  const messages: Array<Doc<'conversationMessages'>> = [];
  let foundCursor = cursor === null;
  let hasMore = false;

  for await (const msg of query) {
    // Skip until we find the cursor
    if (!foundCursor) {
      if (msg._id === cursor) {
        foundCursor = true;
      }
      continue;
    }

    // Apply additional filters not covered by index (only when conversationId index is used)
    if (indexUsed === 'conversationId') {
      if (args.channel !== undefined && msg.channel !== args.channel) {
        continue;
      }
      if (args.direction !== undefined && msg.direction !== args.direction) {
        continue;
      }
    }

    messages.push(msg);

    // Check if we have enough items
    if (messages.length >= numItems) {
      hasMore = true;
      break;
    }
  }

  return {
    items: messages,
    isDone: !hasMore,
    continueCursor:
      messages.length > 0 ? messages[messages.length - 1]._id : null,
    count: messages.length,
  };
}
