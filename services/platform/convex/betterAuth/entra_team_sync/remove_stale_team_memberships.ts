import type { MutationCtx } from '../../_generated/server';
import { components } from '../../_generated/api';

export async function removeStaleTeamMemberships(
  ctx: MutationCtx,
  userId: string,
  currentTeamNames: string[],
  organizationId: string,
): Promise<number> {
  const userMembershipsResult = await ctx.runQuery(
    components.betterAuth.adapter.findMany,
    {
      model: 'teamMember',
      paginationOpts: {
        cursor: null,
        numItems: 100,
      },
      where: [
        {
          field: 'userId',
          value: userId,
          operator: 'eq',
        },
      ],
    },
  );

  if (!userMembershipsResult || userMembershipsResult.page.length === 0) {
    return 0;
  }

  let removedCount = 0;
  const currentTeamNamesLower = currentTeamNames.map((n) => n.toLowerCase());

  for (const membership of userMembershipsResult.page) {
    const teamResult = await ctx.runQuery(
      components.betterAuth.adapter.findOne,
      {
        model: 'team',
        where: [{ field: '_id', value: membership.teamId, operator: 'eq' }],
      },
    );

    if (!teamResult || teamResult.organizationId !== organizationId) {
      continue;
    }

    if (!currentTeamNamesLower.includes(teamResult.name.toLowerCase())) {
      await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
        input: {
          model: 'teamMember',
          where: [{ field: '_id', value: membership._id, operator: 'eq' }],
        },
      });
      removedCount++;

      const remainingMembers = await ctx.runQuery(
        components.betterAuth.adapter.findMany,
        {
          model: 'teamMember',
          paginationOpts: { cursor: null, numItems: 1 },
          where: [
            { field: 'teamId', operator: 'eq', value: membership.teamId },
          ],
        },
      );

      if (!remainingMembers || remainingMembers.page.length === 0) {
        await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
          input: {
            model: 'team',
            where: [{ field: '_id', value: membership.teamId, operator: 'eq' }],
          },
        });
      }
    }
  }

  return removedCount;
}
