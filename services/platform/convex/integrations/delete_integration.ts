/**
 * Delete an integration
 */

import { Id } from '../_generated/dataModel';
import { MutationCtx } from '../_generated/server';

export async function deleteIntegration(
  ctx: MutationCtx,
  integrationId: Id<'integrations'>,
): Promise<void> {
  const integration = await ctx.db.get(integrationId);
  if (!integration) {
    throw new Error('Integration not found');
  }

  if (integration.iconStorageId) {
    await ctx.storage.delete(integration.iconStorageId);
  }

  await ctx.db.delete(integrationId);
}
