import { v } from 'convex/values';

// Raw `query` (not the RLS wrapper) to match the members/sso_providers family:
// org membership is resolved through Better Auth's cross-component adapter and
// guarded explicitly below, the same way `members/mutations.ts` does.
import { query } from '../_generated/server';
import { getCallerRole } from '../enterprise_sso/get_caller_role';
import { platformRoleValidator } from '../enterprise_sso/validators';
import { getPublicHttpApiUrl } from '../lib/helpers/public_storage_url';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';

const scimConfigViewValidator = v.object({
  enabled: v.boolean(),
  defaultRole: platformRoleValidator,
  tokenPrefix: v.union(v.string(), v.null()),
  tokenGeneratedAt: v.union(v.number(), v.null()),
  lastUsedAt: v.union(v.number(), v.null()),
  baseUrl: v.union(v.string(), v.null()),
});

function scimBaseUrl(): string | null {
  try {
    return `${getPublicHttpApiUrl()}/scim/v2`;
  } catch {
    return null;
  }
}

/**
 * Read the org's SCIM provisioning config for the settings UI. Returns the
 * safe view only — never the token hash. Visible to any member of the org;
 * the page itself is gated to developer/admin by the route.
 */
export const get = query({
  args: { organizationId: v.string() },
  returns: scimConfigViewValidator,
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new Error('Unauthenticated');
    const role = await getCallerRole(ctx, {
      organizationId: args.organizationId,
      userId: authUser.userId,
    });
    if (!role) throw new Error('Not a member of this organization');

    const baseUrl = scimBaseUrl();
    const row = await ctx.db
      .query('ssoConnections')
      .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId))
      .first();

    if (!row) {
      return {
        enabled: false,
        defaultRole: 'member' as const,
        tokenPrefix: null,
        tokenGeneratedAt: null,
        lastUsedAt: null,
        baseUrl,
      };
    }
    return {
      enabled: row.scimEnabled,
      defaultRole: row.defaultRole,
      tokenPrefix: row.scimEnabled ? row.scimTokenPrefix : null,
      tokenGeneratedAt: row.scimEnabled
        ? (row.scimTokenGeneratedAt ?? null)
        : null,
      lastUsedAt: row.scimLastUsedAt ?? null,
      baseUrl,
    };
  },
});
