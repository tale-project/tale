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

import type { QueryCtx } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
import { paginateWithFilter, type CursorPaginatedResult } from '../lib/pagination';
import type { QueryConversationsArgs } from './types';

type IndexUsed =
  | 'direction'
  | 'channel'
  | 'status'
  | 'priority'
  | 'customerId'
  | 'organizationId';

/**
 * Create a filter function for fields not covered by the selected index
 */
function createFilter(
  args: QueryConversationsArgs,
  indexUsed: IndexUsed,
): (conversation: Doc<'conversations'>) => boolean {
  return (conversation: Doc<'conversations'>): boolean => {
    if (indexUsed === 'direction') {
      if (args.channel !== undefined && conversation.channel !== args.channel) return false;
      if (args.status !== undefined && conversation.status !== args.status) return false;
      if (args.priority !== undefined && conversation.priority !== args.priority) return false;
      if (args.customerId !== undefined && conversation.customerId !== args.customerId) return false;
    } else if (indexUsed === 'channel') {
      if (args.status !== undefined && conversation.status !== args.status) return false;
      if (args.priority !== undefined && conversation.priority !== args.priority) return false;
      if (args.customerId !== undefined && conversation.customerId !== args.customerId) return false;
    } else if (indexUsed === 'status') {
      if (args.priority !== undefined && conversation.priority !== args.priority) return false;
      if (args.customerId !== undefined && conversation.customerId !== args.customerId) return false;
    } else if (indexUsed === 'priority') {
      if (args.customerId !== undefined && conversation.customerId !== args.customerId) return false;
    }
    return true;
  };
}

export async function queryConversations(
  ctx: QueryCtx,
  args: QueryConversationsArgs,
): Promise<CursorPaginatedResult<Doc<'conversations'>>> {
  // Select the best index based on available filters
  let query;
  let indexUsed: IndexUsed;

  if (args.direction !== undefined) {
    query = ctx.db
      .query('conversations')
      .withIndex('by_organizationId_and_direction', (q) =>
        q.eq('organizationId', args.organizationId).eq('direction', args.direction!),
      );
    indexUsed = 'direction';
  } else if (args.channel !== undefined) {
    query = ctx.db
      .query('conversations')
      .withIndex('by_organizationId_and_channel', (q) =>
        q.eq('organizationId', args.organizationId).eq('channel', args.channel!),
      );
    indexUsed = 'channel';
  } else if (args.status !== undefined) {
    query = ctx.db
      .query('conversations')
      .withIndex('by_organizationId_and_status', (q) =>
        q.eq('organizationId', args.organizationId).eq('status', args.status!),
      );
    indexUsed = 'status';
  } else if (args.priority !== undefined) {
    query = ctx.db
      .query('conversations')
      .withIndex('by_organizationId_and_priority', (q) =>
        q.eq('organizationId', args.organizationId).eq('priority', args.priority!),
      );
    indexUsed = 'priority';
  } else if (args.customerId !== undefined) {
    query = ctx.db
      .query('conversations')
      .withIndex('by_organizationId_and_customerId', (q) =>
        q.eq('organizationId', args.organizationId).eq('customerId', args.customerId!),
      );
    indexUsed = 'customerId';
  } else {
    query = ctx.db
      .query('conversations')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      );
    indexUsed = 'organizationId';
  }

  return paginateWithFilter(query.order('desc'), {
    numItems: args.paginationOpts.numItems,
    cursor: args.paginationOpts.cursor,
    filter: createFilter(args, indexUsed),
  });
}
