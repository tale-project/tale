/**
 * Get all pages for a website
 */

import type { QueryCtx } from '../../_generated/server';
import type { Doc, Id } from '../../_generated/dataModel';

export interface GetPagesByWebsiteArgs {
  websiteId: Id<'websites'>;
  limit?: number;
}

/**
 * Get all pages for a website, ordered by last crawled time (newest first)
 */
export async function getPagesByWebsite(
  ctx: QueryCtx,
  args: GetPagesByWebsiteArgs,
): Promise<Array<Doc<'websitePages'>>> {
  const query = ctx.db
    .query('websitePages')
    .withIndex('by_websiteId_and_lastCrawledAt', (q) =>
      q.eq('websiteId', args.websiteId),
    )
    .order('desc');

  if (args.limit) {
    return await query.take(args.limit);
  }

  const pages: Array<Doc<'websitePages'>> = [];
  for await (const page of query) {
    pages.push(page);
  }
  return pages;
}

