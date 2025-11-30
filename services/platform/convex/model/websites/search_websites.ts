/**
 * Search websites by domain, title, or description
 */

import type { QueryCtx } from '../../_generated/server';
import type { Doc } from '../../_generated/dataModel';

export interface SearchWebsitesArgs {
  organizationId: string;
  searchTerm: string;
  limit?: number;
}

/**
 * Search websites by domain, title, or description
 *
 * ⚠️ TODO: SCALABILITY - Uses .collect() + in-memory filter (not scalable)
 * Before production:
 * - Integrate Algolia, Typesense, or Convex vector search
 * - OR limit to small datasets (< 1000 websites per org)
 */
export async function searchWebsites(
  ctx: QueryCtx,
  args: SearchWebsitesArgs,
): Promise<Array<Doc<'websites'>>> {
  const websites = await ctx.db
    .query('websites')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', args.organizationId),
    )
    .collect();

  const searchLower = args.searchTerm.toLowerCase();
  const filtered = websites.filter((website) => {
    const domainMatch = website.domain?.toLowerCase().includes(searchLower);
    const titleMatch = website.title?.toLowerCase().includes(searchLower);
    const descriptionMatch = website.description
      ?.toLowerCase()
      .includes(searchLower);
    return domainMatch || titleMatch || descriptionMatch;
  });

  // Sort by relevance (exact matches first, then partial matches)
  filtered.sort((a, b) => {
    const aExact = a.domain === args.searchTerm || a.title === args.searchTerm;
    const bExact = b.domain === args.searchTerm || b.title === args.searchTerm;

    if (aExact && !bExact) return -1;
    if (!aExact && bExact) return 1;

    return b._creationTime - a._creationTime;
  });

  const limit = args.limit || 50;
  return filtered.slice(0, limit);
}

