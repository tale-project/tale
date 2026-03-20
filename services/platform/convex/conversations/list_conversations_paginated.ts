/**
 * List conversations using Convex native .paginate() for use with usePaginatedQuery.
 *
 * Dispatches to the best 2-field compound index based on the primary active
 * filter, then applies .filter() for any remaining filters.
 * After pagination, transforms each conversation with customer/message data.
 */

import type { PaginationOptions } from 'convex/server';

import type { QueryCtx } from '../_generated/server';
import type { ConversationItem, ConversationStatus } from './types';

import { transformConversation } from './transform_conversation';

interface ListConversationsPaginatedArgs {
  paginationOpts: PaginationOptions;
  organizationId: string;
  status?: ConversationStatus;
  priority?: string;
  channel?: string;
}

interface PaginatedConversationResult {
  page: ConversationItem[];
  isDone: boolean;
  continueCursor: string;
}

/**
 * Build a query ordered by lastMessageAt descending.
 *
 * When filtering by status, uses `by_org_status_lastMessageAt` so both
 * filter and sort are index-backed. Otherwise uses `by_org_lastMessageAt`.
 */
function buildOrderedQuery(
  ctx: QueryCtx,
  organizationId: string,
  status: ConversationStatus | undefined,
) {
  if (status !== undefined) {
    return ctx.db
      .query('conversations')
      .withIndex('by_org_status_lastMessageAt', (q) =>
        q.eq('organizationId', organizationId).eq('status', status),
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

export async function listConversationsPaginated(
  ctx: QueryCtx,
  args: ListConversationsPaginatedArgs,
): Promise<PaginatedConversationResult> {
  let query = buildOrderedQuery(ctx, args.organizationId, args.status);

  if (args.priority !== undefined) {
    const priority = args.priority;
    query = query.filter((q) => q.eq(q.field('priority'), priority));
  }
  if (args.channel !== undefined) {
    const channel = args.channel;
    query = query.filter((q) => q.eq(q.field('channel'), channel));
  }

  const result = await query.paginate(args.paginationOpts);

  const page = await Promise.all(
    result.page.map((c) => transformConversation(ctx, c)),
  );

  return {
    page,
    isDone: result.isDone,
    continueCursor: result.continueCursor,
  };
}
