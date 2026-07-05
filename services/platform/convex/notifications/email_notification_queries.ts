import { v } from 'convex/values';

import { internalQuery } from '../_generated/server';
import { getUserById } from '../betterAuth/trusted_headers/get_user_by_id';
import { isActionableEmailEnabled } from '../collab/notify';

export const getRecipientEmailInternal = internalQuery({
  args: { userId: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const user = await getUserById(ctx, args.userId);
    const email = user?.email?.trim();
    return email || null;
  },
});

export const isActionableEmailEnabledInternal = internalQuery({
  args: {
    userId: v.string(),
    organizationId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) =>
    isActionableEmailEnabled(ctx, args.userId, args.organizationId),
});
