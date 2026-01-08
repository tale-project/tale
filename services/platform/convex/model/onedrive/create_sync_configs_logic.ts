/**
 * Create Sync Configs Logic - Business logic for creating OneDrive sync configs
 */

import type { MutationCtx } from '../../_generated/server';
import type { FileItem } from './list_folder_contents_logic';

export interface CreateSyncConfigsResult {
  count: number;
}

/**
 * Create sync config records for files in a folder
 * This allows each file to be processed individually in subsequent workflow runs
 */
export async function createSyncConfigsLogic(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    userId: string;
    targetBucket: string;
    folderStoragePrefix: string;
    folderItemPath: string;
    files: Array<FileItem>;
  },
): Promise<CreateSyncConfigsResult> {
  // Insert all sync configs in parallel
  await Promise.all(
    args.files.map((file) =>
      ctx.db.insert('onedriveSyncConfigs', {
        organizationId: args.organizationId,
        userId: args.userId,
        itemId: file.id,
        itemName: file.name,
        itemPath: `${args.folderItemPath}/${file.name}`,
        itemType: 'file',
        storagePrefix: args.folderStoragePrefix,
        targetBucket: args.targetBucket,
        status: 'active',
      }),
    ),
  );

  return { count: args.files.length };
}
