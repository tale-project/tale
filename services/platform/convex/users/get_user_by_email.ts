/**
 * Get user by email - Business logic
 */

import type { QueryCtx } from '../_generated/server';
import { findUserByNormalizedEmail } from '../lib/auth/find_user_by_normalized_email';

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
  const user = await findUserByNormalizedEmail(ctx, email);
  return user?._id ?? null;
}
