/**
 * Deactivate Sync Configs - Stop syncing when the target folder/file is deleted.
 * Covers OneDrive and Google Drive sync config tables.
 */

import type { MutationCtx } from '../_generated/server';
import type { DocumentMetadata } from '../documents/types';
import { toId } from '../lib/type_cast_helpers';

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

  for await (const config of ctx.db
    .query('googleDriveSyncConfigs')
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

/**
 * Deactivate one sync config by id (org-scoped). Tries OneDrive then Google
 * Drive — Convex ids are table-scoped, so at most one lookup hits. No-op when
 * missing, other-org, or already inactive.
 */
export async function deactivateSyncConfigById(
  ctx: MutationCtx,
  organizationId: string,
  configId: string,
): Promise<boolean> {
  const onedrive = await ctx.db.get(toId<'onedriveSyncConfigs'>(configId));
  if (
    onedrive &&
    onedrive.organizationId === organizationId &&
    onedrive.status !== 'inactive'
  ) {
    await ctx.db.patch(onedrive._id, { status: 'inactive' });
    return true;
  }

  const google = await ctx.db.get(toId<'googleDriveSyncConfigs'>(configId));
  if (
    google &&
    google.organizationId === organizationId &&
    google.status !== 'inactive'
  ) {
    await ctx.db.patch(google._id, { status: 'inactive' });
    return true;
  }

  return false;
}

/**
 * Deleting a directly-selected single-file synced document means "stop syncing
 * it" — otherwise the next scheduled run re-imports the file the user just
 * removed (whack-a-mole). Only a directly-selected single-file config maps 1:1
 * to a document; a folder-member doc carries the *folder's* config id, so it is
 * left alone (the folder-delete path owns folder-config deactivation, and a
 * folder keeps syncing its other members). No-op for manual uploads too.
 * Returns whether a config was deactivated.
 */
export async function stopSyncForDeletedDocument(
  ctx: MutationCtx,
  document: { organizationId: string; metadata?: unknown },
): Promise<boolean> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- metadata stored via v.any(); shape is DocumentMetadata written by our sync code
  const meta = (document.metadata ?? {}) as DocumentMetadata;
  if (
    meta.sourceMode !== 'auto' ||
    meta.isDirectlySelected !== true ||
    !meta.syncConfigId
  ) {
    return false;
  }
  return deactivateSyncConfigById(
    ctx,
    document.organizationId,
    meta.syncConfigId,
  );
}
