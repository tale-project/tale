/**
 * Users Internal Mutations
 *
 * Internal mutations for user operations that require admin-level access.
 * These are not callable from the frontend — only via admin-authenticated clients.
 */

import { v } from 'convex/values';

import { internalMutation } from '../_generated/server';
import { resetOwner as resetOwnerHelper } from './reset_owner';

export const resetOwner = internalMutation({
  args: {
    newEmail: v.optional(v.string()),
    newPassword: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await resetOwnerHelper(ctx, args);
  },
});
