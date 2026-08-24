import { v } from 'convex/values';

import { internalQuery, query } from '../_generated/server';
import { authComponent } from '../auth';
import { encryptedSecretValidator } from '../connector_credentials/schema';
import { cloudImportProviderValidator } from './schema';

/**
 * Whether the signed-in member has an active cloud-import grant for a
 * provider in this organization. Does not touch ciphertext.
 */
export const hasAuthorization = query({
  args: {
    organizationId: v.string(),
    provider: cloudImportProviderValidator,
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) return false;
    const userId = String(authUser._id);
    const row = await ctx.db
      .query('userCloudAuthorizations')
      .withIndex('by_org_user_provider', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('userId', userId)
          .eq('provider', args.provider),
      )
      .first();
    return row !== null && row.status === 'active';
  },
});

/**
 * Metadata for the import dialog (account label, needs-reauth). No secrets.
 */
export const getAuthorizationStatus = query({
  args: {
    organizationId: v.string(),
    provider: cloudImportProviderValidator,
  },
  returns: v.union(
    v.null(),
    v.object({
      status: v.union(
        v.literal('active'),
        v.literal('needs-reauth'),
        v.literal('revoked'),
      ),
      accountLabel: v.optional(v.string()),
      scopes: v.array(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) return null;
    const userId = String(authUser._id);
    const row = await ctx.db
      .query('userCloudAuthorizations')
      .withIndex('by_org_user_provider', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('userId', userId)
          .eq('provider', args.provider),
      )
      .first();
    if (!row) return null;
    return {
      status: row.status,
      ...(row.accountLabel !== undefined && {
        accountLabel: row.accountLabel,
      }),
      scopes: row.scopes,
    };
  },
});

/**
 * Internal: ciphertext + refresh material for token resolution. Only called
 * from cloud_import / onedrive node actions for the owning user.
 */
export const getAuthorizationInternal = internalQuery({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    provider: cloudImportProviderValidator,
  },
  returns: v.union(
    v.null(),
    v.object({
      encryptedData: encryptedSecretValidator,
      status: v.union(
        v.literal('active'),
        v.literal('needs-reauth'),
        v.literal('revoked'),
      ),
      scopes: v.array(v.string()),
    }),
  ),
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
    if (!row || row.status === 'revoked') return null;
    return {
      encryptedData: row.encryptedData,
      status: row.status,
      scopes: row.scopes,
    };
  },
});
