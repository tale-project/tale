import { GenericActionCtx } from 'convex/server';
import { DataModel } from '../_generated/dataModel';
import { internal } from '../_generated/api';

type RemoveSsoProviderArgs = {
  organizationId: string;
};

export async function removeSsoProvider(
  ctx: GenericActionCtx<DataModel>,
  args: RemoveSsoProviderArgs,
): Promise<null> {
  const authUser = await ctx.runQuery(
    internal.sso_providers.internal_queries.getAuthUser,
    {},
  );
  if (!authUser) {
    throw new Error('Unauthenticated');
  }

  const callerRole = await ctx.runQuery(
    internal.sso_providers.internal_queries.getCallerRole,
    {
      organizationId: args.organizationId,
      userId: authUser._id,
    },
  );

  if (callerRole !== 'admin') {
    throw new Error('Only Admins can remove SSO providers');
  }

  await ctx.runMutation(internal.sso_providers.internal_mutations.removeProvider, {
    organizationId: args.organizationId,
    actorId: authUser._id,
    actorEmail: authUser.email,
    actorRole: callerRole,
  });

  return null;
}
