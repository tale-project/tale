import { GenericQueryCtx } from 'convex/server';
import { DataModel } from '../_generated/dataModel';
import { components } from '../_generated/api';

type GetCallerRoleArgs = {
  organizationId: string;
  userId: string;
};

export async function getCallerRole(
  ctx: GenericQueryCtx<DataModel>,
  args: GetCallerRoleArgs,
): Promise<string | null> {
  const memberRes = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: 'member',
    paginationOpts: { cursor: null, numItems: 1 },
    where: [
      { field: 'organizationId', value: args.organizationId, operator: 'eq' },
      { field: 'userId', value: args.userId, operator: 'eq' },
    ],
  });

  const member = memberRes?.page?.[0] as { role?: string } | undefined;
  return member?.role?.toLowerCase() ?? null;
}
