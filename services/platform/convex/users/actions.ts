import { v } from 'convex/values';

import { api } from '../_generated/api';
import { action } from '../_generated/server';
import { roleValidator } from './validators';

export const updateUserPassword = action({
  args: {
    currentPassword: v.optional(v.string()),
    newPassword: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await ctx.runMutation(api.users.mutations.updateUserPassword, args);
    return null;
  },
});

export const setMemberPassword = action({
  args: {
    memberId: v.string(),
    newPassword: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await ctx.runMutation(api.users.mutations.setMemberPassword, args);
    return null;
  },
});

export const createMember = action({
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
    return await ctx.runMutation(api.users.mutations.createMember, args);
  },
});
