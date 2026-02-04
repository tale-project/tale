import type { MutationCtx } from '../../_generated/server';
import { components } from '../../_generated/api';

export async function addTeamMember(
  ctx: MutationCtx,
  teamId: string,
  userId: string,
): Promise<void> {
  await ctx.runMutation(components.betterAuth.adapter.create, {
    input: {
      model: 'teamMember',
      data: {
        teamId,
        userId,
        createdAt: Date.now(),
      },
    },
  });
}
