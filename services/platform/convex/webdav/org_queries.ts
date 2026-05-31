import { v } from 'convex/values';

import { getString, isRecord } from '../../lib/utils/type-guards';
import { components } from '../_generated/api';
import { internalQuery } from '../_generated/server';

// Resolve an orgSlug to its organizationId. If `userId` is non-empty,
// also verify the user is an active member of that org. Returns null on
// any failure — never reveal whether the issue was slug mismatch or
// membership shortfall (anti-enumeration).
export const resolveOrgAndCheckMembership = internalQuery({
  args: {
    orgSlug: v.string(),
    userId: v.string(),
  },
  async handler(ctx, args) {
    const orgRow = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: 'organization',
      where: [{ field: 'slug', value: args.orgSlug, operator: 'eq' }],
    });
    if (!isRecord(orgRow)) return null;
    const organizationId = getString(orgRow, '_id');
    if (!organizationId) return null;

    if (args.userId.length === 0) {
      // Slug-only resolve (anonymous lookup before auth check).
      return { organizationId };
    }

    const membership = await ctx.runQuery(
      components.betterAuth.adapter.findOne,
      {
        model: 'member',
        where: [
          { field: 'organizationId', value: organizationId, operator: 'eq' },
          { field: 'userId', value: args.userId, operator: 'eq' },
        ],
      },
    );
    if (!isRecord(membership)) return null;
    // Mirror the canonical filter in
    // lib/rls/organization/get_user_organizations.ts — `disabled` role is
    // a soft-removal marker.
    const role = getString(membership, 'role');
    if (role === 'disabled') return null;

    return { organizationId };
  },
});
