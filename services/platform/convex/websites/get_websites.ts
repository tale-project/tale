/**
 * Get websites with pagination and filtering
 *
 * Optimized to use async iteration with early termination.
 * Uses Set for O(1) status filter lookups.
 */

import type { PaginationOptions } from 'convex/server';

import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import type { GetWebsitesResult } from './types';

export interface GetWebsitesArgs {
  organizationId: string;
  paginationOpts: PaginationOptions;
  status?: string[];
  searchTerm?: string;
}

export async function getWebsites(
  ctx: QueryCtx,
  args: GetWebsitesArgs,
): Promise<GetWebsitesResult> {
  const numItems = args.paginationOpts.numItems;
  const cursor = args.paginationOpts.cursor;

  // Pre-compute filter helpers for O(1) lookups
  const statusSet =
    args.status && args.status.length > 0 ? new Set(args.status) : null;
  const searchLower = args.searchTerm?.toLowerCase();

  // Use async iteration with descending order for newest first
  const query = ctx.db
    .query('websites')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', args.organizationId),
    )
    .order('desc');

  const websites: Array<Doc<'websites'>> = [];
  let foundCursor = cursor === null;
  let hasMore = false;

  for await (const website of query) {
    // Skip until we find the cursor
    if (!foundCursor) {
      if (website._id === cursor) {
        foundCursor = true;
      }
      continue;
    }

    // Apply status filter with O(1) Set lookup
    if (statusSet && (!website.status || !statusSet.has(website.status))) {
      continue;
    }

    // Apply search filter
    if (searchLower) {
      const domainMatch = website.domain?.toLowerCase().includes(searchLower);
      const titleMatch = website.title?.toLowerCase().includes(searchLower);
      const descriptionMatch = website.description
        ?.toLowerCase()
        .includes(searchLower);

      if (!domainMatch && !titleMatch && !descriptionMatch) {
        continue;
      }
    }

    websites.push(website);

    // Check if we have enough items - early termination
    if (websites.length >= numItems) {
      hasMore = true;
      break;
    }
  }

  return {
    page: websites,
    isDone: !hasMore,
    continueCursor:
      websites.length > 0 ? websites[websites.length - 1]._id : undefined,
  };
}
