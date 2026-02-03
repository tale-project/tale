/**
 * SSO Internal Actions
 *
 * Internal actions for SSO authentication processing.
 */

import { v } from 'convex/values';
import { internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import { syncTeamsFromGroups } from '../betterAuth/sso/team_sync';

// @ts-ignore: TS2589 - deep type instantiation
const internalApi = internal as any;

export const handleSsoLogin = internalAction({
  args: {
    email: v.string(),
    name: v.string(),
    microsoftId: v.string(),
    accessToken: v.string(),
    domain: v.string(),
    organizationId: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    error: v.optional(v.string()),
    sessionToken: v.optional(v.string()),
    userId: v.optional(v.string()),
  }),
  handler: async (ctx, args): Promise<{
    success: boolean;
    error?: string;
    sessionToken?: string;
    userId?: string;
  }> => {
    try {
      // Find or create user and link Microsoft account
      const result = await ctx.runMutation(
        internalApi.sso_providers.internal_mutations.findOrCreateSsoUser,
        {
          email: args.email.toLowerCase(),
          name: args.name,
          microsoftId: args.microsoftId,
          accessToken: args.accessToken,
        },
      );

      if (!result.userId) {
        return { success: false, error: 'Failed to create or find user' };
      }

      // Get SSO config for team sync
      const ssoConfig = await ctx.runQuery(
        internalApi.sso_providers.internal_queries.getSsoConfigByDomain,
        { domain: args.domain },
      );

      // Perform team sync if auto-provisioning is enabled
      if (ssoConfig?.autoProvisionEnabled) {
        try {
          const syncResult = await syncTeamsFromGroups({
            ctx: ctx as any,
            userId: result.userId,
            accessToken: args.accessToken,
            excludeGroups: ssoConfig.excludeGroups,
            teamMembershipMode: ssoConfig.teamMembershipMode,
          });

          if (syncResult.errors.length > 0) {
            console.warn('[SSO] Team sync errors:', syncResult.errors);
          }
        } catch (syncError) {
          console.error('[SSO] Team sync failed:', syncError);
        }
      }

      // Create session via Better Auth internals
      const sessionResult = await ctx.runMutation(
        internalApi.sso_providers.internal_mutations.createUserSession,
        {
          userId: result.userId,
          organizationId: args.organizationId,
        },
      );

      return {
        success: true,
        userId: result.userId,
        sessionToken: sessionResult.sessionToken,
      };
    } catch (error) {
      console.error('[SSO] handleSsoLogin error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
});
