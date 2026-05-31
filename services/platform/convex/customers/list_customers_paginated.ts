/**
 * List customers using Convex native .paginate() for use with usePaginatedQuery.
 *
 * Dispatches to the best 2-field compound index based on the primary active
 * filter, then applies .filter() for any remaining filters.
 */

import type { PaginationOptions, PaginationResult } from 'convex/server';

import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { customersSearchStrategy, runEntitySearch } from '../lib/search';

interface FilterIndex {
  field: string;
  index: string;
}

const FILTER_INDEXES: FilterIndex[] = [
  { field: 'status', index: 'by_organizationId_and_status' },
  { field: 'source', index: 'by_organizationId_and_source' },
  { field: 'locale', index: 'by_organizationId_and_locale' },
];

interface ListCustomersPaginatedArgs {
  paginationOpts: PaginationOptions;
  organizationId: string;
  status?: string;
  source?: string;
  locale?: string;
  /** Case-insensitive backend search over name / email / externalId. When set,
   *  routes through the shared search contract instead of the plain list. */
  search?: string;
}

type FilterArgs = Record<string, string | undefined>;

function buildBaseQuery(
  ctx: QueryCtx,
  organizationId: string,
  primary: FilterIndex | undefined,
  filterArgs: FilterArgs,
) {
  if (primary) {
    const tableQuery = ctx.db.query('customers');
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
    .query('customers')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', organizationId),
    );
}

export async function listCustomersPaginated(
  ctx: QueryCtx,
  args: ListCustomersPaginatedArgs,
): Promise<PaginationResult<Doc<'customers'>>> {
  // Backend search path: org-scoped substring scan over name/email/externalId
  // via the shared contract, with facets applied as a post-filter. Behind the
  // same `{ page, isDone, continueCursor }` shape as the plain list.
  if (args.search?.trim()) {
    const accessFilter = (row: Doc<'customers'>): boolean =>
      (!args.status || row.status === args.status) &&
      (!args.source || row.source === args.source) &&
      (!args.locale || row.locale === args.locale);
    return await runEntitySearch(ctx, customersSearchStrategy, {
      organizationId: args.organizationId,
      term: args.search,
      paginationOpts: args.paginationOpts,
      accessFilter,
    });
  }

  const filterArgs: FilterArgs = {
    status: args.status,
    source: args.source,
    locale: args.locale,
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

  return await query.paginate(args.paginationOpts);
}
