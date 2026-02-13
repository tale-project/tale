/**
 * List conversations using Convex native .paginate() for use with usePaginatedQuery.
 *
 * Dispatches to the best 2-field compound index based on the primary active
 * filter, then applies .filter() for any remaining filters.
 * After pagination, transforms each conversation with customer/message data.
 */

import type { PaginationOptions } from 'convex/server';

import type { QueryCtx } from '../_generated/server';
import type { ConversationItem } from './types';

import { transformConversation } from './transform_conversation';

interface FilterIndex {
  field: string;
  index: string;
}

const FILTER_INDEXES: FilterIndex[] = [
  { field: 'status', index: 'by_organizationId_and_status' },
  { field: 'priority', index: 'by_organizationId_and_priority' },
  { field: 'channel', index: 'by_organizationId_and_channel' },
];

interface ListConversationsPaginatedArgs {
  paginationOpts: PaginationOptions;
  organizationId: string;
  status?: string;
  priority?: string;
  channel?: string;
}

type FilterArgs = Record<string, string | undefined>;

interface PaginatedConversationResult {
  page: ConversationItem[];
  isDone: boolean;
  continueCursor: string;
}

function buildBaseQuery(
  ctx: QueryCtx,
  organizationId: string,
  primary: FilterIndex | undefined,
  filterArgs: FilterArgs,
) {
  if (primary) {
    const tableQuery = ctx.db.query('conversations');
    const indexFn = (q: {
      eq: (
        field: string,
        value: string | undefined,
      ) => { eq: (field: string, value: string | undefined) => unknown };
    }) =>
      q
        .eq('organizationId', organizationId)
        .eq(primary.field, filterArgs[primary.field]);
    // @ts-expect-error -- dynamic index name; runtime correct, Convex types require literals
    return tableQuery.withIndex(primary.index, indexFn);
  }

  return ctx.db
    .query('conversations')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', organizationId),
    );
}

export async function listConversationsPaginated(
  ctx: QueryCtx,
  args: ListConversationsPaginatedArgs,
): Promise<PaginatedConversationResult> {
  const filterArgs: FilterArgs = {
    status: args.status,
    priority: args.priority,
    channel: args.channel,
  };

  const primary = FILTER_INDEXES.find(({ field }) => filterArgs[field]);
  let query = buildBaseQuery(
    ctx,
    args.organizationId,
    primary,
    filterArgs,
  ).order('desc');

  for (const { field } of FILTER_INDEXES) {
    if (filterArgs[field] && field !== primary?.field) {
      const value = filterArgs[field];
      // @ts-expect-error -- dynamic field name; runtime is correct, Convex types require literal field paths
      query = query.filter((q) => q.eq(q.field(field), value));
    }
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
