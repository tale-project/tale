import type { Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

export interface FindPendingPagesArgs {
  websiteId: Id<'websites'>;
  limit: number;
}

export interface FindPendingPagesResult {
  pages: Array<{ _id: Id<'websitePages'>; url: string }>;
  hasMore: boolean;
}

export async function findPendingPages(
  ctx: QueryCtx,
  args: FindPendingPagesArgs,
): Promise<FindPendingPagesResult> {
  const pages: Array<{ _id: Id<'websitePages'>; url: string }> = [];
  let count = 0;
  let hasMore = false;

  const query = ctx.db
    .query('websitePages')
    .withIndex('by_websiteId_and_syncStatus', (q) =>
      q.eq('websiteId', args.websiteId).eq('syncStatus', 'pending'),
    );

  for await (const page of query) {
    if (count >= args.limit) {
      hasMore = true;
      break;
    }
    pages.push({ _id: page._id, url: page.url });
    count++;
  }

  return { pages, hasMore };
}
