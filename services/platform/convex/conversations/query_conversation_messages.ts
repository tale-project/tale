/**
 * Query conversation messages with flexible filtering and pagination support (business logic)
 *
 * Uses smart index selection based on available filters:
 * - conversationId: by_conversationId_and_deliveredAt
 * - org + channel + direction: by_org_channel_direction_deliveredAt
 * - default: by_organizationId_and_deliveredAt
 */

import type { QueryCtx } from '../_generated/server';
import type { Id, Doc } from '../_generated/dataModel';
import { paginateWithFilter, type CursorPaginatedResult } from '../lib/pagination';

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

function buildQuery(ctx: QueryCtx, args: QueryConversationMessagesArgs) {
  if (args.conversationId !== undefined) {
    return {
      query: ctx.db
        .query('conversationMessages')
        .withIndex('by_conversationId_and_deliveredAt', (q) =>
          q.eq('conversationId', args.conversationId!),
        )
        .order('asc' as const),
      indexedFields: { conversationId: true } as const,
    };
  }

  if (args.channel !== undefined && args.direction !== undefined) {
    return {
      query: ctx.db
        .query('conversationMessages')
        .withIndex('by_org_channel_direction_deliveredAt', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('channel', args.channel!)
            .eq('direction', args.direction!),
        )
        .order('asc' as const),
      indexedFields: { channel: true, direction: true } as const,
    };
  }

  return {
    query: ctx.db
      .query('conversationMessages')
      .withIndex('by_organizationId_and_deliveredAt', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .order('asc' as const),
    indexedFields: {} as const,
  };
}

export async function queryConversationMessages(
  ctx: QueryCtx,
  args: QueryConversationMessagesArgs,
): Promise<CursorPaginatedResult<Doc<'conversationMessages'>>> {
  const { query, indexedFields } = buildQuery(ctx, args);

  const needsChannelFilter = !('channel' in indexedFields) && args.channel !== undefined;
  const needsDirectionFilter = !('direction' in indexedFields) && args.direction !== undefined;
  const needsFilter = needsChannelFilter || needsDirectionFilter;

  const filter = needsFilter
    ? (msg: Doc<'conversationMessages'>): boolean => {
        if (needsChannelFilter && msg.channel !== args.channel) return false;
        if (needsDirectionFilter && msg.direction !== args.direction) return false;
        return true;
      }
    : undefined;

  return paginateWithFilter(query, {
    numItems: args.paginationOpts.numItems,
    cursor: args.paginationOpts.cursor,
    filter,
  });
}
