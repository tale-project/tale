/**
 * Deactivate Sync Configs - Stop syncing when the target folder is deleted.
 */

import type { MutationCtx } from '../_generated/server';

/**
 * Deactivate every active sync config whose synced tree lives at or below
 * the given hub folder path. Deleting a synced folder means "stop syncing
 * it" — leaving the config active would resurrect the folder on the next
 * sync run.
 */
export async function deactivateSyncConfigsForPath(
  ctx: MutationCtx,
  organizationId: string,
  folderPath: string,
): Promise<number> {
  let deactivated = 0;

  for await (const config of ctx.db
    .query('onedriveSyncConfigs')
    .withIndex('by_organizationId_and_status', (q) =>
      q.eq('organizationId', organizationId).eq('status', 'active'),
    )) {
    const itemPath = config.itemPath ?? '';
    if (itemPath === folderPath || itemPath.startsWith(`${folderPath}/`)) {
      await ctx.db.patch(config._id, { status: 'inactive' });
      deactivated++;
    }
  }

  return deactivated;
}
