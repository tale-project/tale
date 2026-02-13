/**
 * List audit logs using Convex native .paginate() for use with usePaginatedQuery.
 *
 * Dispatches to the best compound index based on the primary active filter.
 * Uses 3-field indexes (org + filter + timestamp) to maintain timestamp ordering.
 */

import type { PaginationOptions, PaginationResult } from 'convex/server';

import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

interface FilterIndex {
  field: string;
  index: string;
}

const FILTER_INDEXES: FilterIndex[] = [
  { field: 'category', index: 'by_org_category_timestamp' },
  { field: 'resourceType', index: 'by_org_resourceType_timestamp' },
];

interface ListAuditLogsPaginatedArgs {
  paginationOpts: PaginationOptions;
  organizationId: string;
  category?: string;
  resourceType?: string;
}

type FilterArgs = Record<string, string | undefined>;

function buildBaseQuery(
  ctx: QueryCtx,
  organizationId: string,
  primary: FilterIndex | undefined,
  filterArgs: FilterArgs,
) {
  if (primary) {
    const tableQuery = ctx.db.query('auditLogs');
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
    .query('auditLogs')
    .withIndex('by_organizationId_and_timestamp', (q) =>
      q.eq('organizationId', organizationId),
    );
}

export async function listAuditLogsPaginated(
  ctx: QueryCtx,
  args: ListAuditLogsPaginatedArgs,
): Promise<PaginationResult<Doc<'auditLogs'>>> {
  const filterArgs: FilterArgs = {
    category: args.category,
    resourceType: args.resourceType,
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
