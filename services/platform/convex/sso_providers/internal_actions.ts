import { v } from 'convex/values';

import { internalAction } from '../_generated/server';
import { handleSsoLogin as handleSsoLoginFn } from './handle_sso_login';

export const handleSsoLogin = internalAction({
  args: {
    email: v.string(),
    name: v.string(),
    externalId: v.string(),
    providerId: v.string(),
    jobTitle: v.optional(v.string()),
    appRoles: v.optional(v.array(v.string())),
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
    accessTokenExpiresAt: v.optional(v.number()),
    organizationId: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    error: v.optional(v.string()),
    sessionToken: v.optional(v.string()),
    userId: v.optional(v.string()),
  }),
  handler: async (ctx, args) => handleSsoLoginFn(ctx, args),
});
