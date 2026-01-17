/**
 * Query conversation messages with flexible filtering and pagination support (business logic)
 *
 * Uses smart index selection based on available filters:
 * - conversationId: by_conversationId_and_deliveredAt
 * - org + channel + direction: by_org_channel_direction_deliveredAt
 * - default: by_organizationId_and_deliveredAt
 */

import type { QueryCtx } from '../../_generated/server';
import type { Id, Doc } from '../../_generated/dataModel';
import { paginateWithFilter, type CursorPaginatedResult } from '../../lib/pagination';

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

export async function queryConversationMessages(
  ctx: QueryCtx,
  args: QueryConversationMessagesArgs,
): Promise<CursorPaginatedResult<Doc<'conversationMessages'>>> {
  // Select the best index based on available filters
  let query;
  let indexUsed: 'conversationId' | 'org_channel_direction' | 'organizationId';

  if (args.conversationId !== undefined) {
    query = ctx.db
      .query('conversationMessages')
      .withIndex('by_conversationId_and_deliveredAt', (q) =>
        q.eq('conversationId', args.conversationId!),
      )
      .order('asc');
    indexUsed = 'conversationId';
  } else if (args.channel !== undefined && args.direction !== undefined) {
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
    query = ctx.db
      .query('conversationMessages')
      .withIndex('by_organizationId_and_deliveredAt', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .order('asc');
    indexUsed = 'organizationId';
  }

  // Create filter for fields not covered by the selected index
  const filter = (msg: Doc<'conversationMessages'>): boolean => {
    if (indexUsed === 'conversationId') {
      if (args.channel !== undefined && msg.channel !== args.channel) return false;
      if (args.direction !== undefined && msg.direction !== args.direction) return false;
    }
    return true;
  };

  return paginateWithFilter(query, {
    numItems: args.paginationOpts.numItems,
    cursor: args.paginationOpts.cursor,
    filter,
  });
}
