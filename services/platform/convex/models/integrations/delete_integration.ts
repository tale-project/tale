/**
 * Delete an integration
 */

import { MutationCtx } from '../../_generated/server';
import { Id } from '../../_generated/dataModel';

export async function deleteIntegration(
  ctx: MutationCtx,
  integrationId: Id<'integrations'>,
): Promise<void> {
  const integration = await ctx.db.get(integrationId);
  if (!integration) {
    throw new Error('Integration not found');
  }

  await ctx.db.delete(integrationId);
}

