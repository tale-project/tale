/**
 * Read the current user's `lastActiveOrganizationId` — the persistent
 * preference set by `recordOrgSwitch` whenever the user signs in to an org.
 *
 * Unlike Better Auth's `session.activeOrganizationId` (which is wiped on
 * logout), this value lives on the user record and survives logout/login,
 * letting the dashboard auto-select the same org the user was last in.
 */

import { v } from 'convex/values';

import { getString, isRecord } from '../../lib/utils/type-guards';
import { components } from '../_generated/api';
import { query } from '../_generated/server';
import { authComponent } from '../auth';

export const getLastActiveOrganizationId = query({
  args: {},
  returns: v.union(v.string(), v.null()),
  handler: async (ctx) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      return null;
    }

    const row = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: 'user',
      where: [{ field: '_id', value: String(authUser._id), operator: 'eq' }],
    });

    if (!isRecord(row)) return null;
    return getString(row, 'lastActiveOrganizationId') ?? null;
  },
});
