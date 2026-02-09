import { GenericMutationCtx } from 'convex/server';

import { DataModel } from '../_generated/dataModel';
import * as AuditLogHelpers from '../audit_logs/helpers';

type RemoveProviderArgs = {
  organizationId: string;
  actorId: string;
  actorEmail: string;
  actorRole: string;
};

export async function removeProvider(
  ctx: GenericMutationCtx<DataModel>,
  args: RemoveProviderArgs,
): Promise<null> {
  const existing = await ctx.db
    .query('ssoProviders')
    .withIndex('organizationId', (q) =>
      q.eq('organizationId', args.organizationId),
    )
    .first();

  if (!existing) {
    return null;
  }

  await ctx.db.delete(existing._id);

  await AuditLogHelpers.logSuccess(
    ctx,
    {
      organizationId: args.organizationId,
      actor: {
        id: args.actorId,
        email: args.actorEmail,
        role: args.actorRole,
        type: 'user',
      },
    },
    'sso_provider_deleted',
    'integration',
    'ssoProvider',
    existing._id,
    existing.providerId,
    {
      providerId: existing.providerId,
    },
    undefined,
  );

  return null;
}
