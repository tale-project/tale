/**
 * Users domain queries
 *
 * Public query operations for users.
 */

import { v } from 'convex/values';

import { components } from '../_generated/api';
import { query } from '../_generated/server';
import { getStrictestPasswordPolicyForUser } from '../governance/helpers';
import { getAuthUserIdentity } from '../lib/rls';
import { getUserOrganizations } from '../lib/rls/organization/get_user_organizations';
import { hasAnyUsers as hasAnyUsersHelper } from './has_any_users';

/**
 * Check if any users exist in the system.
 * Used to determine if this is a fresh installation that should redirect to sign-up.
 */
export const hasAnyUsers = query({
  args: {},
  returns: v.boolean(),
  handler: async (ctx): Promise<boolean> => {
    return await hasAnyUsersHelper(ctx);
  },
});

/**
 * Get the current authenticated user.
 * Returns null if not authenticated.
 */
export const getCurrentUser = query({
  args: {},
  returns: v.union(
    v.object({
      userId: v.string(),
      email: v.optional(v.string()),
      name: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (
    ctx,
  ): Promise<{
    userId: string;
    email?: string;
    name?: string;
  } | null> => {
    return await getAuthUserIdentity(ctx);
  },
});

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Password expiry status for the current authenticated user.
 *
 * Returns `{ expired: false, daysUntilExpiry: null }` when:
 *  - the user has no credential account (OAuth-only)
 *  - no org's password_policy has rotation enabled (rotationDays === 0)
 *
 * Otherwise `daysUntilExpiry` is signed (negative when expired).
 *
 * Multi-org: the strictest policy across the user's memberships applies
 * (shortest positive rotation window).
 */
export const getPasswordExpiryStatus = query({
  args: {},
  returns: v.object({
    expired: v.boolean(),
    daysUntilExpiry: v.union(v.number(), v.null()),
    hasCredential: v.boolean(),
    rotationEnabled: v.boolean(),
  }),
  handler: async (
    ctx,
  ): Promise<{
    expired: boolean;
    daysUntilExpiry: number | null;
    hasCredential: boolean;
    rotationEnabled: boolean;
  }> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      return {
        expired: false,
        daysUntilExpiry: null,
        hasCredential: false,
        rotationEnabled: false,
      };
    }

    const credentialResult = await ctx.runQuery(
      components.betterAuth.adapter.findMany,
      {
        model: 'account',
        where: [
          { field: 'userId', value: authUser.userId, operator: 'eq' },
          { field: 'providerId', value: 'credential', operator: 'eq' },
        ],
        paginationOpts: { cursor: null, numItems: 1 },
      },
    );
    const hasCredential = (credentialResult?.page?.length ?? 0) > 0;
    if (!hasCredential) {
      return {
        expired: false,
        daysUntilExpiry: null,
        hasCredential: false,
        rotationEnabled: false,
      };
    }

    const orgs = await getUserOrganizations(ctx, authUser);
    const { policy, effectiveAt } = await getStrictestPasswordPolicyForUser(
      ctx,
      orgs.map((o) => o.organizationId),
    );

    if (policy.rotationDays <= 0) {
      return {
        expired: false,
        daysUntilExpiry: null,
        hasCredential: true,
        rotationEnabled: false,
      };
    }

    const meta = await ctx.db
      .query('userPasswordMetadata')
      .withIndex('by_userId', (q) => q.eq('userId', authUser.userId))
      .first();
    const anchor = Math.max(meta?.passwordChangedAt ?? 0, effectiveAt ?? 0);

    // No anchor yet (policy never activated rotation and user never had
    // their password change timestamped). Treat as not-expired — the
    // next password change will seed passwordChangedAt.
    if (anchor === 0) {
      return {
        expired: false,
        daysUntilExpiry: null,
        hasCredential: true,
        rotationEnabled: true,
      };
    }

    const expiresAt = anchor + policy.rotationDays * DAY_MS;
    const now = Date.now();
    const daysUntilExpiry = Math.ceil((expiresAt - now) / DAY_MS);
    return {
      expired: now >= expiresAt,
      daysUntilExpiry,
      hasCredential: true,
      rotationEnabled: true,
    };
  },
});
