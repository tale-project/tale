import { v } from 'convex/values';

import { internalMutation } from '../_generated/server';
import { createUserSession as createUserSessionFn } from './create_user_session';
import { findOrCreateSsoUser as findOrCreateSsoUserFn } from './find_or_create_sso_user';
import { platformRoleValidator } from './validators';

/**
 * SSO sign-in provisioning wrappers. The login orchestrator (`handle_sso_login`)
 * calls these to find-or-create the Better Auth user + org membership and mint a
 * session. (Inbound SCIM provisioning lives in `scim/internal_mutations.ts`.)
 */

export const findOrCreateSsoUser = internalMutation({
  args: {
    email: v.string(),
    name: v.string(),
    externalId: v.string(),
    providerId: v.string(),
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
    accessTokenExpiresAt: v.optional(v.number()),
    organizationId: v.string(),
    role: platformRoleValidator,
    // When true (auto-assign roles from the IdP is on), re-apply the mapped role
    // to an EXISTING membership on every login so IdP role changes propagate.
    syncRole: v.optional(v.boolean()),
  },
  returns: v.object({
    userId: v.union(v.string(), v.null()),
    isNewUser: v.boolean(),
  }),
  handler: async (ctx, args) => findOrCreateSsoUserFn(ctx, args),
});

export const createUserSession = internalMutation({
  args: {
    userId: v.string(),
    organizationId: v.string(),
  },
  returns: v.object({
    sessionToken: v.union(v.string(), v.null()),
    sessionId: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => createUserSessionFn(ctx, args),
});
