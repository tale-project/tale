import { v } from 'convex/values';

import { components } from '../_generated/api';
import { query } from '../_generated/server';
import { authComponent } from '../auth';
import { getOrganizationMember } from '../lib/rls';
import { resolveDefaultModel } from './resolve_default_model';

interface BetterAuthTeamMember {
  teamId: string;
}

interface BetterAuthFindManyResult<T> {
  page: T[];
  continueCursor: string;
  isDone: boolean;
}

export const getMyDefaultModel = query({
  args: {
    organizationId: v.string(),
  },
  returns: v.union(
    v.object({
      providerName: v.string(),
      modelId: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    let authUser = null;
    try {
      authUser = await authComponent.getAuthUser(ctx);
    } catch {}
    if (!authUser) return null;

    const member = await getOrganizationMember(ctx, args.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });

    const membershipsResult: BetterAuthFindManyResult<BetterAuthTeamMember> =
      await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'teamMember',
        paginationOpts: { cursor: null, numItems: 100 },
        where: [
          { field: 'userId', operator: 'eq', value: String(authUser._id) },
        ],
      });

    const teamIds = membershipsResult?.page.map((m) => m.teamId) ?? [];

    return resolveDefaultModel(ctx, args.organizationId, teamIds, member.role);
  },
});
