/**
 * Users domain queries
 *
 * Public query operations for users.
 */

import { v } from 'convex/values';

import { query } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls';
import { hasAnyUsers as hasAnyUsersHelper } from './helpers';

/**
 * Check if any users exist in the system.
 * Used to determine if this is a fresh installation that should redirect to sign-up.
 */
export const hasAnyUsers = query({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    return await hasAnyUsersHelper(ctx);
  },
});

/**
 * Get the current authenticated user.
 * Returns null if not authenticated.
 */
export const getCurrentUser = query({
  args: {},
  returns: v.union(
    v.object({
      userId: v.string(),
      email: v.optional(v.string()),
      name: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    return await getAuthUserIdentity(ctx);
  },
});
