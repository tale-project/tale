import { ConvexError, v } from 'convex/values';

// Raw `mutation` (not the RLS wrapper) + explicit admin checks — same pattern
// as `members/mutations.ts` and the enterprise-SSO config mutations.
import { mutation, type MutationCtx } from '../_generated/server';
import * as AuditLogHelpers from '../audit_logs/helpers';
import { getCallerRole } from '../enterprise_sso/get_caller_role';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { isAdmin } from '../lib/rls/helpers/role_helpers';
import {
  generateScimToken,
  hashScimToken,
  scimTokenPrefix,
} from './helpers/crypto';

interface Caller {
  userId: string;
  email?: string;
  role: string;
}

async function requireAdmin(
  ctx: MutationCtx,
  organizationId: string,
): Promise<Caller> {
  const authUser = await getAuthUserIdentity(ctx);
  if (!authUser) {
    throw new ConvexError({
      code: 'unauthenticated',
      message: 'Unauthenticated',
    });
  }
  const role = await getCallerRole(ctx, {
    organizationId,
    userId: authUser.userId,
  });
  if (!isAdmin(role)) {
    throw new ConvexError({
      code: 'forbidden',
      message: 'Only admins can manage SCIM provisioning',
    });
  }
  return { userId: authUser.userId, email: authUser.email, role: role ?? '' };
}

function getConnection(ctx: MutationCtx, organizationId: string) {
  return ctx.db
    .query('ssoConnections')
    .withIndex('by_org', (q) => q.eq('organizationId', organizationId))
    .first();
}

/** Defaults for a fresh SCIM token row. The connection CONFIG lives in files;
 *  this row holds only the inbound SCIM token state. */
function newConnectionDefaults(organizationId: string, createdBy: string) {
  const now = Date.now();
  return {
    organizationId,
    scimEnabled: false,
    scimTokenHash: '',
    scimTokenPrefix: '',
    createdBy,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Generate (or rotate) the org's SCIM bearer token and enable provisioning.
 * Returns the plaintext token EXACTLY ONCE — only its hash is persisted.
 */
export const regenerateToken = mutation({
  args: { organizationId: v.string() },
  returns: v.object({ token: v.string(), tokenPrefix: v.string() }),
  handler: async (ctx, args) => {
    const caller = await requireAdmin(ctx, args.organizationId);
    const token = generateScimToken();
    const tokenHash = await hashScimToken(token);
    const tokenPrefix = scimTokenPrefix(token);
    const now = Date.now();

    const row = await getConnection(ctx, args.organizationId);
    if (row) {
      await ctx.db.patch(row._id, {
        scimEnabled: true,
        scimTokenHash: tokenHash,
        scimTokenPrefix: tokenPrefix,
        scimTokenGeneratedAt: now,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert('ssoConnections', {
        ...newConnectionDefaults(args.organizationId, caller.userId),
        scimEnabled: true,
        scimTokenHash: tokenHash,
        scimTokenPrefix: tokenPrefix,
        scimTokenGeneratedAt: now,
      });
    }

    await AuditLogHelpers.logSuccess(ctx, {
      auditCtx: {
        organizationId: args.organizationId,
        actor: {
          id: caller.userId,
          email: caller.email,
          role: caller.role,
          type: 'user',
        },
      },
      action: row ? 'scim_token_rotated' : 'scim_enabled',
      category: 'security',
      resourceType: 'scim',
      resourceId: args.organizationId,
      newState: { tokenPrefix },
    });

    return { token, tokenPrefix };
  },
});

/** Disable SCIM provisioning and revoke the token (clears the stored hash). */
export const disable = mutation({
  args: { organizationId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const caller = await requireAdmin(ctx, args.organizationId);
    const row = await getConnection(ctx, args.organizationId);
    if (!row) return null;
    await ctx.db.patch(row._id, {
      scimEnabled: false,
      scimTokenHash: '',
      scimTokenPrefix: '',
      updatedAt: Date.now(),
    });

    await AuditLogHelpers.logSuccess(ctx, {
      auditCtx: {
        organizationId: args.organizationId,
        actor: {
          id: caller.userId,
          email: caller.email,
          role: caller.role,
          type: 'user',
        },
      },
      action: 'scim_disabled',
      category: 'security',
      resourceType: 'scim',
      resourceId: args.organizationId,
    });
    return null;
  },
});
