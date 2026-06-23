import { v } from 'convex/values';

import { internalQuery } from '../../_generated/server';
import { getAuthUserIdentity } from '../../lib/rls/auth/get_auth_user_identity';
import { getCallerRole as getCallerRoleFn } from '../get_caller_role';

/** Internal reads used by `config/actions.ts` for auth + reuse-on-update. */

export const getAuthUser = internalQuery({
  args: {},
  returns: v.union(
    v.object({ _id: v.string(), email: v.string(), name: v.string() }),
    v.null(),
  ),
  handler: async (ctx) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return null;
    return {
      _id: authUser.userId,
      email: authUser.email ?? '',
      name: authUser.name ?? '',
    };
  },
});

export const getCallerRole = internalQuery({
  args: { organizationId: v.string(), userId: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => getCallerRoleFn(ctx, args),
});
