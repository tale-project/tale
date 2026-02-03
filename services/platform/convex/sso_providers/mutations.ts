/**
 * SSO Providers Mutations
 *
 * Public actions for SSO provider configurations.
 */

import { v } from 'convex/values';
import { action } from '../_generated/server';
import { internal } from '../_generated/api';

// Type assertions to avoid TS2589 deep type instantiation errors
// This is a known issue with complex Convex API type inference
// @ts-ignore: TS2589 - deep type instantiation
const internalApi = internal as any;

const ssoProviderInputValidator = v.object({
  organizationId: v.string(),
  providerId: v.string(),
  issuer: v.string(),
  domain: v.string(),
  clientId: v.string(),
  clientSecret: v.string(),
  scopes: v.array(v.string()),
  autoProvisionEnabled: v.boolean(),
  excludeGroups: v.array(v.string()),
  teamMembershipMode: v.union(v.literal('sync'), v.literal('additive')),
});

export const upsert = action({
  args: ssoProviderInputValidator,
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    // Using type assertion to avoid TS2589 deep type instantiation
    const getAuthUserFn = internalApi.sso_providers.internal_queries.getAuthUser as any;
    const authUser: { _id: string; email: string; name: string } | null =
      await ctx.runQuery(getAuthUserFn, {});
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    const getCallerRoleFn = internalApi.sso_providers.internal_queries.getCallerRole as any;
    const callerRole: string | null = await ctx.runQuery(getCallerRoleFn, {
      organizationId: args.organizationId,
      userId: authUser._id,
    });

    if (callerRole !== 'admin') {
      throw new Error('Only Admins can configure SSO providers');
    }

    const encryptFn = internalApi.lib.crypto.actions.encryptStringInternal as any;
    const clientIdEncrypted: string = await ctx.runAction(encryptFn, {
      plaintext: args.clientId,
    });

    const clientSecretEncrypted: string = await ctx.runAction(encryptFn, {
      plaintext: args.clientSecret,
    });

    const upsertProviderFn = internalApi.sso_providers.internal_mutations.upsertProvider as any;
    const providerId: string = await ctx.runMutation(upsertProviderFn,
      {
        organizationId: args.organizationId,
        providerId: args.providerId,
        issuer: args.issuer,
        domain: args.domain.toLowerCase(),
        clientIdEncrypted,
        clientSecretEncrypted,
        scopes: args.scopes,
        autoProvisionEnabled: args.autoProvisionEnabled,
        excludeGroups: args.excludeGroups,
        teamMembershipMode: args.teamMembershipMode,
        actorId: authUser._id,
        actorEmail: authUser.email,
        actorRole: callerRole,
      },
    );

    return providerId;
  },
});

export const remove = action({
  args: {
    organizationId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    // Using type assertions to avoid TS2589 deep type instantiation
    const getAuthUserFn = internalApi.sso_providers.internal_queries.getAuthUser as any;
    const authUser: { _id: string; email: string; name: string } | null =
      await ctx.runQuery(getAuthUserFn, {});
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    const getCallerRoleFn = internalApi.sso_providers.internal_queries.getCallerRole as any;
    const callerRole: string | null = await ctx.runQuery(getCallerRoleFn, {
      organizationId: args.organizationId,
      userId: authUser._id,
    });

    if (callerRole !== 'admin') {
      throw new Error('Only Admins can remove SSO providers');
    }

    const removeProviderFn = internalApi.sso_providers.internal_mutations.removeProvider as any;
    await ctx.runMutation(removeProviderFn, {
      organizationId: args.organizationId,
      actorId: authUser._id,
      actorEmail: authUser.email,
      actorRole: callerRole,
    });

    return null;
  },
});
