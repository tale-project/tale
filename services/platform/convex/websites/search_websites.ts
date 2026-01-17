/**
 * Search websites by domain, title, or description
 *
 * Optimized to use async iteration for memory efficiency.
 * Note: For better scalability, consider adding a search index.
 */

import type { QueryCtx } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';

export interface SearchWebsitesArgs {
  organizationId: string;
  searchTerm: string;
  limit?: number;
}

export async function searchWebsites(
  ctx: QueryCtx,
  args: SearchWebsitesArgs,
): Promise<Array<Doc<'websites'>>> {
  const searchLower = args.searchTerm.toLowerCase();
  const limit = args.limit || 50;

  // Use async iteration for memory efficiency
  const query = ctx.db
    .query('websites')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', args.organizationId),
    );

  const filtered: Array<Doc<'websites'>> = [];

  for await (const website of query) {
    const domainMatch = website.domain?.toLowerCase().includes(searchLower);
    const titleMatch = website.title?.toLowerCase().includes(searchLower);
    const descriptionMatch = website.description
      ?.toLowerCase()
      .includes(searchLower);

    if (domainMatch || titleMatch || descriptionMatch) {
      filtered.push(website);
    }
  }

  // Sort by relevance (exact matches first, then partial matches)
  filtered.sort((a, b) => {
    const aExact = a.domain === args.searchTerm || a.title === args.searchTerm;
    const bExact = b.domain === args.searchTerm || b.title === args.searchTerm;

    if (aExact && !bExact) return -1;
    if (!aExact && bExact) return 1;

    return b._creationTime - a._creationTime;
  });

  return filtered.slice(0, limit);
}
