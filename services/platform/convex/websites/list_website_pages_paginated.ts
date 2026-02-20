/**
 * List website pages using Convex native .paginate() for use with usePaginatedQuery.
 *
 * Returns pages for a given website, ordered by lastCrawledAt descending.
 */

import type { PaginationOptions, PaginationResult } from 'convex/server';

import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

interface ListWebsitePagesPaginatedArgs {
  paginationOpts: PaginationOptions;
  websiteId: Id<'websites'>;
}

export async function listWebsitePagesPaginated(
  ctx: QueryCtx,
  args: ListWebsitePagesPaginatedArgs,
): Promise<PaginationResult<Doc<'websitePages'>>> {
  return await ctx.db
    .query('websitePages')
    .withIndex('by_websiteId_and_lastCrawledAt', (q) =>
      q.eq('websiteId', args.websiteId),
    )
    .order('desc')
    .paginate(args.paginationOpts);
}
