import type { MutationCtx } from '../../_generated/server';
import { components } from '../../_generated/api';

export async function isTeamMember(
  ctx: MutationCtx,
  teamId: string,
  userId: string,
): Promise<boolean> {
  const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: 'teamMember',
    paginationOpts: {
      cursor: null,
      numItems: 1,
    },
    where: [
      {
        field: 'teamId',
        value: teamId,
        operator: 'eq',
      },
      {
        field: 'userId',
        value: userId,
        operator: 'eq',
      },
    ],
  });

  return result && result.page.length > 0;
}
