import { v } from 'convex/values';

import { internalMutation } from '../_generated/server';
import { trustedHeadersAuthenticate } from '../betterAuth/trusted_headers';

export const authenticate = internalMutation({
  args: {
    email: v.string(),
    name: v.string(),
    role: v.string(),
    teams: v.union(
      v.array(v.object({ id: v.string(), name: v.string() })),
      v.null(),
    ),
    existingSessionToken: v.optional(v.string()),
    ipAddress: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    secret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await trustedHeadersAuthenticate(ctx, args);
  },
});
