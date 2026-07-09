/**
 * Query conversations with flexible filtering and pagination support (business logic)
 *
 * Uses smart index selection based on available filters:
 * - direction: by_organizationId_and_direction
 * - channel: by_organizationId_and_channel
 * - status: by_organizationId_and_status
 * - priority: by_organizationId_and_priority
 * - contactId: by_organizationId_and_contactId
 * - default: by_organizationId
 */

import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import {
  paginateWithFilter,
  type CursorPaginatedResult,
} from '../lib/pagination';
import type { QueryConversationsArgs } from './types';

/**
 * Build a query ordered by lastMessageAt descending.
 *
 * Uses `by_org_status_lastMessageAt` when status is provided (index-backed
 * filter + sort), otherwise `by_org_lastMessageAt` (sort only, remaining
 * filters applied via paginateWithFilter).
 */
function buildOrderedQuery(ctx: QueryCtx, args: QueryConversationsArgs) {
  const { organizationId } = args;

  if (args.status !== undefined) {
    return ctx.db
      .query('conversations')
      .withIndex('by_org_status_lastMessageAt', (q) =>
        q.eq('organizationId', organizationId).eq('status', args.status),
      )
      .order('desc');
  }

  // Contact filter (issue #2618) is index-backed when it's the primary facet.
  if (args.contactId !== undefined) {
    const contactId = args.contactId;
    return ctx.db
      .query('conversations')
      .withIndex('by_organizationId_and_contactId', (q) =>
        q.eq('organizationId', organizationId).eq('contactId', contactId),
      )
      .order('desc');
  }

  return ctx.db
    .query('conversations')
    .withIndex('by_org_lastMessageAt', (q) =>
      q.eq('organizationId', organizationId),
    )
    .order('desc');
}

export async function queryConversations(
  ctx: QueryCtx,
  args: QueryConversationsArgs,
): Promise<CursorPaginatedResult<Doc<'conversations'>>> {
  const query = buildOrderedQuery(ctx, args);

  const needsDirectionFilter = args.direction !== undefined;
  const needsChannelFilter = args.channel !== undefined;
  const needsPriorityFilter = args.priority !== undefined;
  const needsContactIdFilter = args.contactId !== undefined;
  const needsFilter =
    needsDirectionFilter ||
    needsChannelFilter ||
    needsPriorityFilter ||
    needsContactIdFilter;

  const filter = needsFilter
    ? (conversation: Doc<'conversations'>): boolean => {
        if (needsDirectionFilter && conversation.direction !== args.direction)
          return false;
        if (needsChannelFilter && conversation.channel !== args.channel)
          return false;
        if (needsPriorityFilter && conversation.priority !== args.priority)
          return false;
        if (needsContactIdFilter && conversation.contactId !== args.contactId)
          return false;
        return true;
      }
    : undefined;

  return paginateWithFilter(query, {
    numItems: args.paginationOpts.numItems,
    cursor: args.paginationOpts.cursor,
    filter,
  });
}
