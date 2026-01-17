/**
 * Batch fetch user names from Better Auth user table
 *
 * This helper efficiently fetches multiple user names in parallel queries,
 * avoiding the N+1 query problem when displaying creator names in document lists.
 * Note: Uses parallel individual lookups since Better Auth adapter doesn't support IN queries.
 */

import type { QueryCtx } from '../_generated/server';
import { components } from '../_generated/api';

/**
 * Batch fetch user display names for multiple user IDs
 *
 * @param ctx - Query context
 * @param userIds - Array of user IDs to fetch names for
 * @returns Map of userId -> display name (name or email)
 */
export async function getUserNamesBatch(
  ctx: QueryCtx,
  userIds: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();

  // Filter out empty/undefined IDs and deduplicate
  const uniqueIds = [...new Set(userIds.filter((id) => id))];

  if (uniqueIds.length === 0) {
    return result;
  }

  // Fetch all users in parallel batches
  // Better Auth adapter findMany doesn't support IN queries, so we need to batch individual lookups
  // But we can parallelize them for efficiency
  // Note: Better Auth uses _id as the primary key, not id
  const userPromises = uniqueIds.map(async (userId) => {
    const userRes = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'user',
      paginationOpts: { cursor: null, numItems: 1 },
      where: [{ field: '_id', value: userId, operator: 'eq' }],
    });

    const user = userRes?.page?.[0] as
      | { _id?: string; name?: string; email?: string }
      | undefined;

    if (user) {
      const displayName = user.name ?? user.email;
      if (displayName) {
        return { userId, displayName };
      }
    }
    return null;
  });

  const users = await Promise.all(userPromises);

  for (const user of users) {
    if (user) {
      result.set(user.userId, user.displayName);
    }
  }

  return result;
}
