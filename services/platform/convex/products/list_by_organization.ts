/**
 * List products by organization with cursor-based pagination
 *
 * Uses Convex's native .paginate() for optimal performance.
 */

import type { QueryCtx } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
import type { CursorPaginatedResult } from '../lib/pagination';

export interface ListByOrganizationArgs {
  organizationId: string;
  paginationOpts: {
    numItems: number;
    cursor: string | null;
  };
}

export async function listByOrganization(
  ctx: QueryCtx,
  args: ListByOrganizationArgs,
): Promise<CursorPaginatedResult<Doc<'products'>>> {
  const result = await ctx.db
    .query('products')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', args.organizationId),
    )
    .order('desc')
    .paginate(args.paginationOpts);

  return {
    page: result.page,
    isDone: result.isDone,
    continueCursor: result.continueCursor,
  };
}
