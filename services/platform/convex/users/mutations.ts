/**
 * Users Mutations
 *
 * Public mutations for user operations.
 */

import { v } from 'convex/values';
import { mutation } from '../_generated/server';
import { authComponent } from '../auth';
import { updateUserPassword as updateUserPasswordHelper } from './update_user_password';
import { createMember as createMemberHelper } from './create_member';
import { roleValidator } from './validators';

export const updateUserPassword = mutation({
  args: {
    currentPassword: v.string(),
    newPassword: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    await updateUserPasswordHelper(ctx, args);
    return null;
  },
});

export const createMember = mutation({
  args: {
    organizationId: v.string(),
    email: v.string(),
    password: v.string(),
    displayName: v.optional(v.string()),
    role: v.optional(roleValidator),
  },
  returns: v.object({
    userId: v.string(),
    memberId: v.string(),
  }),
  handler: async (ctx, args) => {
    return await createMemberHelper(ctx, args);
  },
});
