import { v } from 'convex/values';

import { query } from '../_generated/server';

/**
 * Public login-page query: is sign-in SSO configured + enabled for this
 * deployment? Runs pre-auth (no identity), so it returns only the minimal,
 * non-sensitive shape the login screen needs to show the SSO entry point.
 * Shape matches the legacy `sso_providers.queries.isSsoConfigured` so the
 * login/onboarding hooks repoint with no field changes.
 */
export const isConfigured = query({
  args: {},
  returns: v.object({
    enabled: v.boolean(),
    providerType: v.optional(v.string()),
    seamlessSsoEnabled: v.optional(v.boolean()),
  }),
  handler: async (ctx) => {
    const row = await ctx.db
      .query('ssoConnections')
      .filter((q) => q.eq(q.field('enabled'), true))
      .first();
    if (!row || !row.enabled) return { enabled: false };
    return {
      enabled: true,
      providerType: row.oidcConfig?.providerId ?? row.protocol,
      // Seamless (silent) SSO is now driven by a query param, not stored config.
      seamlessSsoEnabled: false,
    };
  },
});
