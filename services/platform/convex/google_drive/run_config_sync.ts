/**
 * Sync one Google Drive sync config: resolve the owner's cloud-import token,
 * then reconcile a folder or a single file.
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
  sourceDeleted?: boolean;
}

async function resolveToken(
  ctx: ActionCtx,
  organizationId: string,
  userId: string,
): Promise<string | null> {
  const cloud = await ctx.runAction(
    internal.cloud_import.resolve_token.resolveAccessToken,
    {
      organizationId,
      userId,
      provider: 'google-drive',
    },
  );
  return cloud.success ? cloud.accessToken : null;
}

/**
 * Sync a single config. Throws on a hard failure so the caller can mark the
 * config `error`.
 */
export async function syncOneConfig(
  ctx: ActionCtx,
  args: { organizationId: string; config: SyncConfigItem },
): Promise<SyncOneResult> {
  const { organizationId, config } = args;

  const token = await resolveToken(ctx, organizationId, config.userId);
  if (!token) {
    throw new Error('No valid Google Drive token for the config owner');
  }

  if (config.itemType === 'folder') {
    const listed = await ctx.runAction(
      internal.google_drive.internal_actions.listFolderContents,
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
