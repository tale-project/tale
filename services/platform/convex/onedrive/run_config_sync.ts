/**
 * Sync one OneDrive sync config: resolve the owner's Graph token, then either
 * reconcile a folder (batch import + prune) or upsert a single file.
 *
 * This is the per-config unit of work the sync workflow's loop node invokes once
 * per active config — so each config is a durable, retryable, observable
 * workflow iteration rather than a hidden inner loop.
 */

import { internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import { reconcileFolder } from './run_folder_reconcile';
import { reconcileSingleFile } from './run_single_file_reconcile';

export interface SyncConfigItem {
  configId: string;
  userId: string;
  itemType: 'file' | 'folder';
  itemId: string;
  itemName: string;
  itemPath?: string;
  teamId?: string;
}

export interface SyncOneResult {
  created: number;
  skipped: number;
  deleted: number;
  errorsCount: number;
  /** Single-file sync only: the source file was deleted at the origin (404),
   *  so its mirror was removed and the config should be deactivated. */
  sourceDeleted?: boolean;
}

/** Resolve a usable Graph token for a user, refreshing once if expired. */
async function resolveToken(
  ctx: ActionCtx,
  userId: string,
): Promise<string | null> {
  const info = await ctx.runQuery(
    internal.onedrive.internal_queries.getUserToken,
    { userId },
  );
  if (info.token) return info.token;
  if (info.needsRefresh && info.accountId && info.refreshToken) {
    const refreshed = await ctx.runAction(
      internal.onedrive.internal_actions.refreshToken,
      { accountId: info.accountId, refreshToken: info.refreshToken },
    );
    return refreshed.success ? (refreshed.accessToken ?? null) : null;
  }
  return null;
}

/**
 * Sync a single config. Throws on a hard failure (no token, list/read/upload
 * error) so the caller can mark the config `error`.
 */
export async function syncOneConfig(
  ctx: ActionCtx,
  args: { organizationId: string; config: SyncConfigItem },
): Promise<SyncOneResult> {
  const { organizationId, config } = args;

  const token = await resolveToken(ctx, config.userId);
  if (!token) {
    throw new Error('No valid Microsoft Graph token for the config owner');
  }

  if (config.itemType === 'folder') {
    const listed = await ctx.runAction(
      internal.onedrive.internal_actions.listFolderContents,
      { itemId: config.itemId, token, recursive: true },
    );
    if (!listed.success) {
      throw new Error(listed.error ?? 'Failed to list folder contents');
    }
    const result = await reconcileFolder(ctx, {
      organizationId,
      configId: config.configId,
      itemId: config.itemId,
      itemName: config.itemName,
      itemPath: config.itemPath,
      userId: config.userId,
      teamId: config.teamId,
      files: listed.files ?? [],
      token,
    });
    return {
      created: result.created,
      skipped: result.skipped,
      deleted: result.deleted,
      errorsCount: result.errorsCount,
    };
  }

  // Single-file config: reconcile the one tracked file through the shared
  // import pipeline (dedup by external id → update the existing doc in place)
  // and collapse any duplicate rows a prior no-dedup version created for it.
  const result = await reconcileSingleFile(ctx, {
    organizationId,
    configId: config.configId,
    itemId: config.itemId,
    itemName: config.itemName,
    itemPath: config.itemPath,
    userId: config.userId,
    teamId: config.teamId,
    token,
  });
  return {
    created: result.created,
    skipped: result.skipped,
    deleted: result.deleted,
    errorsCount: result.errorsCount,
    sourceDeleted: result.sourceDeleted,
  };
}
