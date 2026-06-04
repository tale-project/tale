import { v } from 'convex/values';

import { components } from '../_generated/api';
import { query } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
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
      authUser = await getAuthUserIdentity(ctx);
    } catch {}
    if (!authUser) return null;

    const member = await getOrganizationMember(
      ctx,
      args.organizationId,
      authUser,
    );

    const membershipsResult: BetterAuthFindManyResult<BetterAuthTeamMember> =
      await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'teamMember',
        paginationOpts: { cursor: null, numItems: 100 },
        where: [{ field: 'userId', operator: 'eq', value: authUser.userId }],
      });

    const teamIds = membershipsResult?.page.map((m) => m.teamId) ?? [];

    return resolveDefaultModel(
      ctx,
      args.organizationId,
      member.userId,
      teamIds,
      member.role,
    );
  },
});
