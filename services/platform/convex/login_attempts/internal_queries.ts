import { v } from 'convex/values';

import { DEFAULT_TRUSTED_PROXIES } from '../../lib/shared/schemas/governance';
import { isRecord, getString } from '../../lib/utils/type-guards';
import { components } from '../_generated/api';
import { internalQuery } from '../_generated/server';
import { parseLoginPolicy } from './helpers';

/**
 * Read the current lockout state for an email. Returns `{ lockedUntil: null }`
 * if no record exists. Used by the Better Auth `hooks.before` matcher on
 * `/sign-in/email` to gate requests before they hit the password check.
 */
export const getLockState = internalQuery({
  args: { email: v.string() },
  returns: v.object({ lockedUntil: v.union(v.number(), v.null()) }),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('loginAttempts')
      .withIndex('by_email', (q) => q.eq('email', args.email.toLowerCase()))
      .first();
    return { lockedUntil: row?.lockedUntil ?? null };
  },
});

// Single-org convention: the seeded org has slug `default`. Read trusted
// proxies from its login policy; fall back to built-in defaults if the
// row or org is missing.
const DEFAULT_ORG_SLUG = 'default';

/**
 * Read the effective trusted-proxies list from the default org's login
 * policy. Exposed as a query so callers in any ctx (action / mutation)
 * can invoke it via `ctx.runQuery`.
 */
export const getTrustedProxies = internalQuery({
  args: {},
  returns: v.array(v.string()),
  handler: async (ctx) => {
    const orgRes = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'organization',
      paginationOpts: { cursor: null, numItems: 1 },
      where: [{ field: 'slug', value: DEFAULT_ORG_SLUG, operator: 'eq' }],
    });
    const orgRow = orgRes?.page?.[0];
    if (!isRecord(orgRow)) return [...DEFAULT_TRUSTED_PROXIES];
    const orgId = getString(orgRow, '_id');
    if (!orgId) return [...DEFAULT_TRUSTED_PROXIES];

    const row = await ctx.db
      .query('governancePolicies')
      .withIndex('by_org_policyType', (q) =>
        q.eq('organizationId', orgId).eq('policyType', 'login_policy'),
      )
      .first();
    const policy = parseLoginPolicy(row?.config);
    return policy.trustedProxies.length > 0
      ? policy.trustedProxies
      : [...DEFAULT_TRUSTED_PROXIES];
  },
});
