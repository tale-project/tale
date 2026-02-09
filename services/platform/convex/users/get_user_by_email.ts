/**
 * Get user by email - Business logic
 */

import { components } from '../_generated/api';
import { QueryCtx } from '../_generated/server';

/**
 * Get user ID by email from Better Auth.
 *
 * Architecture:
 * - Better Auth manages authentication and stores user credentials
 * - We store Better Auth's internal user ID (_id) as identityId in our members table
 * - This links our member records to Better Auth users
 */
export async function getUserIdByEmail(
  ctx: QueryCtx,
  email: string,
): Promise<string | null> {
  // Query Better Auth's user table to find user by email
  const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: 'user',
    paginationOpts: {
      cursor: null,
      numItems: 1,
    },
    where: [
      {
        field: 'email',
        value: email,
        operator: 'eq',
      },
    ],
  });

  if (result && result.page.length > 0) {
    // Return Better Auth's internal user ID (_id)
    return result.page[0]._id;
  }

  return null;
}
