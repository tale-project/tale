/**
 * Get websites with pagination and filtering
 */

import type { QueryCtx } from '../../_generated/server';
import type { PaginationOptions } from 'convex/server';
import type { GetWebsitesResult } from './types';

export interface GetWebsitesArgs {
  organizationId: string;
  paginationOpts: PaginationOptions;
  status?: string[];
  searchTerm?: string;
}

/**
 * Get a paginated list of websites for an organization
 *
 * ⚠️ TODO: SCALABILITY - Currently uses .collect() which loads ALL websites
 * When integrating crawler service, replace with:
 * - Proper Convex .paginate() without in-memory filtering
 * - Consider Convex vector search or external search service for text filtering
 */
export async function getWebsites(
  ctx: QueryCtx,
  args: GetWebsitesArgs,
): Promise<GetWebsitesResult> {
  // Start with all websites in the organization
  let websites = await ctx.db
    .query('websites')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', args.organizationId),
    )
    .collect();

  // Apply status filter if provided
  if (args.status && args.status.length > 0) {
    websites = websites.filter(
      (w) => w.status && args.status!.includes(w.status),
    );
  }

  // Apply search filter if provided
  if (args.searchTerm) {
    const searchLower = args.searchTerm.toLowerCase();
    websites = websites.filter((website) => {
      const domainMatch = website.domain?.toLowerCase().includes(searchLower);
      const titleMatch = website.title?.toLowerCase().includes(searchLower);
      const descriptionMatch = website.description
        ?.toLowerCase()
        .includes(searchLower);
      return domainMatch || titleMatch || descriptionMatch;
    });
  }

  // Sort by creation time (newest first)
  websites.sort((a, b) => b._creationTime - a._creationTime);

  // Apply pagination
  const startIndex = args.paginationOpts.cursor
    ? websites.findIndex((w) => w._id === args.paginationOpts.cursor) + 1
    : 0;
  const endIndex = startIndex + args.paginationOpts.numItems;
  const paginatedWebsites = websites.slice(startIndex, endIndex);

  return {
    page: paginatedWebsites,
    isDone: endIndex >= websites.length,
    continueCursor:
      paginatedWebsites.length > 0
        ? paginatedWebsites[paginatedWebsites.length - 1]._id
        : undefined,
  };
}

