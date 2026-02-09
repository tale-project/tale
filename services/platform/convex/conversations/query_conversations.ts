/**
 * Query conversations with flexible filtering and pagination support (business logic)
 *
 * Uses smart index selection based on available filters:
 * - direction: by_organizationId_and_direction
 * - channel: by_organizationId_and_channel
 * - status: by_organizationId_and_status
 * - priority: by_organizationId_and_priority
 * - customerId: by_organizationId_and_customerId
 * - default: by_organizationId
 */

import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import type { QueryConversationsArgs } from './types';

import {
  paginateWithFilter,
  type CursorPaginatedResult,
} from '../lib/pagination';

function buildQuery(ctx: QueryCtx, args: QueryConversationsArgs) {
  const { organizationId } = args;

  if (args.direction !== undefined) {
    return {
      query: ctx.db
        .query('conversations')
        .withIndex('by_organizationId_and_direction', (q) =>
          q
            .eq('organizationId', organizationId)
            .eq('direction', args.direction!),
        ),
      indexedFields: { direction: true } as const,
    };
  }

  if (args.channel !== undefined) {
    return {
      query: ctx.db
        .query('conversations')
        .withIndex('by_organizationId_and_channel', (q) =>
          q.eq('organizationId', organizationId).eq('channel', args.channel!),
        ),
      indexedFields: { channel: true } as const,
    };
  }

  if (args.status !== undefined) {
    return {
      query: ctx.db
        .query('conversations')
        .withIndex('by_organizationId_and_status', (q) =>
          q.eq('organizationId', organizationId).eq('status', args.status!),
        ),
      indexedFields: { status: true } as const,
    };
  }

  if (args.priority !== undefined) {
    return {
      query: ctx.db
        .query('conversations')
        .withIndex('by_organizationId_and_priority', (q) =>
          q.eq('organizationId', organizationId).eq('priority', args.priority!),
        ),
      indexedFields: { priority: true } as const,
    };
  }

  if (args.customerId !== undefined) {
    return {
      query: ctx.db
        .query('conversations')
        .withIndex('by_organizationId_and_customerId', (q) =>
          q
            .eq('organizationId', organizationId)
            .eq('customerId', args.customerId!),
        ),
      indexedFields: { customerId: true } as const,
    };
  }

  return {
    query: ctx.db
      .query('conversations')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', organizationId),
      ),
    indexedFields: {} as const,
  };
}

export async function queryConversations(
  ctx: QueryCtx,
  args: QueryConversationsArgs,
): Promise<CursorPaginatedResult<Doc<'conversations'>>> {
  const { query, indexedFields } = buildQuery(ctx, args);

  const needsDirectionFilter =
    !('direction' in indexedFields) && args.direction !== undefined;
  const needsChannelFilter =
    !('channel' in indexedFields) && args.channel !== undefined;
  const needsStatusFilter =
    !('status' in indexedFields) && args.status !== undefined;
  const needsPriorityFilter =
    !('priority' in indexedFields) && args.priority !== undefined;
  const needsCustomerIdFilter =
    !('customerId' in indexedFields) && args.customerId !== undefined;
  const needsFilter =
    needsDirectionFilter ||
    needsChannelFilter ||
    needsStatusFilter ||
    needsPriorityFilter ||
    needsCustomerIdFilter;

  const filter = needsFilter
    ? (conversation: Doc<'conversations'>): boolean => {
        if (needsDirectionFilter && conversation.direction !== args.direction)
          return false;
        if (needsChannelFilter && conversation.channel !== args.channel)
          return false;
        if (needsStatusFilter && conversation.status !== args.status)
          return false;
        if (needsPriorityFilter && conversation.priority !== args.priority)
          return false;
        if (
          needsCustomerIdFilter &&
          conversation.customerId !== args.customerId
        )
          return false;
        return true;
      }
    : undefined;

  return paginateWithFilter(query.order('desc'), {
    numItems: args.paginationOpts.numItems,
    cursor: args.paginationOpts.cursor,
    filter,
  });
}
