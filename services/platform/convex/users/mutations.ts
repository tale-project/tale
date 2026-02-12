/**
 * Users Mutations
 *
 * Public mutations for user operations.
 */

import { v } from 'convex/values';

import { mutation } from '../_generated/server';
import { authComponent } from '../auth';
import { createMember as createMemberHelper } from './create_member';
import { setMemberPassword as setMemberPasswordHelper } from './set_member_password';
import { updateUserPassword as updateUserPasswordHelper } from './update_user_password';
import { roleValidator } from './validators';

export const updateUserPassword = mutation({
  args: {
    currentPassword: v.optional(v.string()),
    newPassword: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    await updateUserPasswordHelper(ctx, args);
    return null;
  },
});

export const setMemberPassword = mutation({
  args: {
    memberId: v.string(),
    newPassword: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await setMemberPasswordHelper(ctx, args);
    return null;
  },
});

export const createMember = mutation({
  args: {
    organizationId: v.string(),
    email: v.string(),
    password: v.optional(v.string()),
    displayName: v.optional(v.string()),
    role: v.optional(roleValidator),
  },
  returns: v.object({
    userId: v.string(),
    memberId: v.string(),
    isExistingUser: v.boolean(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ userId: string; memberId: string; isExistingUser: boolean }> => {
    return await createMemberHelper(ctx, args);
  },
});
