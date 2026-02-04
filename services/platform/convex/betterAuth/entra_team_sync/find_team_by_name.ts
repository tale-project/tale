import type { MutationCtx } from '../../_generated/server';
import { components } from '../../_generated/api';
import type { Team } from './types';

export async function findTeamByName(
  ctx: MutationCtx,
  name: string,
  organizationId: string,
): Promise<Team | null> {
  const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: 'team',
    paginationOpts: {
      cursor: null,
      numItems: 100,
    },
    where: [
      {
        field: 'organizationId',
        value: organizationId,
        operator: 'eq',
      },
    ],
  });

  if (!result || result.page.length === 0) {
    return null;
  }

  const team = result.page.find(
    (t: { name: string }) => t.name.toLowerCase() === name.toLowerCase(),
  );
  return team
    ? { _id: team._id, name: team.name, organizationId: team.organizationId }
    : null;
}
