/**
 * Delete an email provider
 */

import type { MutationCtx } from '../../_generated/server';
import type { Doc } from '../../_generated/dataModel';

export async function deleteProvider(
  ctx: MutationCtx,
  args: { providerId: Doc<'emailProviders'>['_id'] },
): Promise<null> {
  const provider = await ctx.db.get(args.providerId);
  if (!provider) {
    throw new Error('Email provider not found');
  }

  // Prevent deleting the default provider if there are other providers
  if (provider.isDefault) {
    const otherProviders = await ctx.db
      .query('emailProviders')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', provider.organizationId),
      )
      .filter((q) => q.neq(q.field('_id'), args.providerId))
      .collect();

    if (otherProviders.length > 0) {
      throw new Error(
        'Cannot delete the default provider. Please set another provider as default first.',
      );
    }
  }

  await ctx.db.delete(args.providerId);
  return null;
}

