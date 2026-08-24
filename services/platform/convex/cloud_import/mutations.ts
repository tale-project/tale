import { v } from 'convex/values';

import { internalMutation, mutation } from '../_generated/server';
import { encryptedSecretValidator } from '../connector_credentials/schema';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';
import { cloudImportProviderValidator } from './schema';

/**
 * Upsert one (org, user, provider) authorization. Reconnect replaces the
 * sealed payload and clears needs-reauth.
 */
export const upsertAuthorizationInternal = internalMutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    provider: cloudImportProviderValidator,
    encryptedData: encryptedSecretValidator,
    scopes: v.array(v.string()),
    accountLabel: v.optional(v.string()),
  },
  returns: v.id('userCloudAuthorizations'),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('userCloudAuthorizations')
      .withIndex('by_org_user_provider', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('userId', args.userId)
          .eq('provider', args.provider),
      )
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        encryptedData: args.encryptedData,
        scopes: args.scopes,
        ...(args.accountLabel !== undefined && {
          accountLabel: args.accountLabel,
        }),
        status: 'active' as const,
        updatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert('userCloudAuthorizations', {
      organizationId: args.organizationId,
      userId: args.userId,
      provider: args.provider,
      encryptedData: args.encryptedData,
      scopes: args.scopes,
      ...(args.accountLabel !== undefined && {
        accountLabel: args.accountLabel,
      }),
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const markNeedsReauthInternal = internalMutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    provider: cloudImportProviderValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('userCloudAuthorizations')
      .withIndex('by_org_user_provider', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('userId', args.userId)
          .eq('provider', args.provider),
      )
      .first();
    if (row && row.status === 'active') {
      await ctx.db.patch(row._id, {
        status: 'needs-reauth',
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});

export const revokeAuthorizationInternal = internalMutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    provider: cloudImportProviderValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('userCloudAuthorizations')
      .withIndex('by_org_user_provider', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('userId', args.userId)
          .eq('provider', args.provider),
      )
      .first();
    if (row) {
      await ctx.db.delete(row._id);
    }
    return null;
  },
});

/**
 * Member disconnects their own Knowledge cloud-import grant for a provider.
 * Idempotent when already absent.
 */
export const revokeAuthorization = mutation({
  args: {
    organizationId: v.string(),
    provider: cloudImportProviderValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const auth = await requireOrgMembershipById(ctx, args.organizationId);
    const row = await ctx.db
      .query('userCloudAuthorizations')
      .withIndex('by_org_user_provider', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('userId', auth.userId)
          .eq('provider', args.provider),
      )
      .first();
    if (row) {
      await ctx.db.delete(row._id);
    }
    return null;
  },
});
