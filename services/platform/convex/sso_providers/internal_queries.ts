import { v } from 'convex/values';

import { internalQuery } from '../_generated/server';
import { getAuthUser as getAuthUserFn } from './get_auth_user';
import { getCallerRole as getCallerRoleFn } from './get_caller_role';
import { getSsoConfig as getSsoConfigFn } from './get_sso_config';
import { ssoConfigValidator } from './validators';

export const getAuthUser = internalQuery({
  args: {},
  returns: v.union(
    v.object({
      _id: v.string(),
      email: v.string(),
      name: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx) => getAuthUserFn(ctx),
});

export const getCallerRole = internalQuery({
  args: {
    organizationId: v.string(),
    userId: v.string(),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => getCallerRoleFn(ctx, args),
});

export const getSsoConfig = internalQuery({
  args: {},
  returns: v.union(ssoConfigValidator, v.null()),
  handler: async (ctx) => getSsoConfigFn(ctx),
});

export const getByOrganization = internalQuery({
  args: {
    organizationId: v.string(),
  },
  returns: v.union(
    v.object({
      _id: v.id('ssoProviders'),
      clientIdEncrypted: v.string(),
      clientSecretEncrypted: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const provider = await ctx.db
      .query('ssoProviders')
      .withIndex('organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .first();

    if (!provider) {
      return null;
    }

    return {
      _id: provider._id,
      clientIdEncrypted: provider.clientIdEncrypted,
      clientSecretEncrypted: provider.clientSecretEncrypted,
    };
  },
});
