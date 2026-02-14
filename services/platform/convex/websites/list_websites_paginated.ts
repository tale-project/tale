/**
 * List websites using Convex native .paginate() for use with usePaginatedQuery.
 *
 * Dispatches to the best 2-field compound index based on the primary active
 * filter, then applies .filter() for any remaining filters.
 */

import type { PaginationOptions, PaginationResult } from 'convex/server';

import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

interface FilterIndex {
  field: string;
  index: string;
}

const FILTER_INDEXES: FilterIndex[] = [
  { field: 'status', index: 'by_organizationId_and_status' },
];

interface ListWebsitesPaginatedArgs {
  paginationOpts: PaginationOptions;
  organizationId: string;
  status?: string;
}

type FilterArgs = Record<string, string | undefined>;

function buildBaseQuery(
  ctx: QueryCtx,
  organizationId: string,
  primary: FilterIndex | undefined,
  filterArgs: FilterArgs,
) {
  if (primary) {
    const tableQuery = ctx.db.query('websites');
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
    .query('websites')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', organizationId),
    );
}

export async function listWebsitesPaginated(
  ctx: QueryCtx,
  args: ListWebsitesPaginatedArgs,
): Promise<PaginationResult<Doc<'websites'>>> {
  const filterArgs: FilterArgs = {
    status: args.status,
  };

  const primary = FILTER_INDEXES.find(({ field }) => filterArgs[field]);
  const query = buildBaseQuery(
    ctx,
    args.organizationId,
    primary,
    filterArgs,
  ).order('desc');

  return await query.paginate(args.paginationOpts);
}
