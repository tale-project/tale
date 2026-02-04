import type { MutationCtx } from '../../_generated/server';
import { components } from '../../_generated/api';
import type { Team } from './types';

export async function createTeam(
  ctx: MutationCtx,
  name: string,
  organizationId: string,
): Promise<Team> {
  const result = await ctx.runMutation(components.betterAuth.adapter.create, {
    input: {
      model: 'team',
      data: {
        name,
        organizationId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    },
  });

  const teamId = result._id ?? result.id ?? String(result);
  return { _id: teamId, name, organizationId };
}
