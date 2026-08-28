import type { Sql, TransactionSql } from 'postgres';

import { getFileMetadata } from '../../../convex/google_drive/get_file_metadata.ts';
import { importFiles } from '../../../convex/google_drive/import_files.ts';
import { listFolderContents } from '../../../convex/google_drive/list_folder_contents.ts';
import { resolveCloudAccessToken } from '../cloud_import/service.ts';
import {
  cancelSyncConfigRow,
  createSyncImportDeps,
  runSyncConfigJobWith,
  runSyncScanWith,
  type GraphTokenResult,
  type PgSyncImportDeps,
  type SyncProviderAdapter,
} from '../onedrive/service.ts';

/**
 * Google Drive Knowledge sync — the 0.5 twin of `convex/google_drive`,
 * bound to the provider-generic engine in `domains/onedrive/service.ts`
 * (the 0.4 tree shares the same helpers across the two domains). Deltas
 * from OneDrive: tokens are GRANT-ONLY (no login-linked Google shortcut),
 * hashes are Drive md5Checksums, native Docs/Sheets/Slides are refused by
 * the reused fetch modules (no binary export), and there is no SharePoint
 * analogue — the engine reads My Drive only.
 */

const GOOGLE_DRIVE_CONFIG_TABLE = 'app.google_drive_sync_configs';

/** Grant-only token resolution (the 0.4 `withGoogleToken`). */
export async function resolveDriveTokenForUser(
  sql: Sql,
  args: { organizationId: string; userId: string },
): Promise<GraphTokenResult> {
  const cloud = await resolveCloudAccessToken(sql, {
    organizationId: args.organizationId,
    userId: args.userId,
    provider: 'google-drive',
  });
  if (cloud.success) return { success: true, token: cloud.accessToken };
  return {
    success: false,
    error:
      'Google Drive is not authorized for importing. Connect Google Drive from Documents.',
  };
}

export const GOOGLE_DRIVE_SYNC_ADAPTER: SyncProviderAdapter = {
  displayName: 'Google Drive',
  sourceProvider: 'google_drive',
  configTable: GOOGLE_DRIVE_CONFIG_TABLE,
  configJobName: 'google_drive.sync_config',
  singletonPrefix: 'gdrive-sync-',
  metadataItemIdKeys: ['googleDriveItemId', 'googleDriveId'],
  resolveToken: (sql, args) => resolveDriveTokenForUser(sql, args),
  listFolderContents: (args) => listFolderContents(args),
  getFileMetadata: (itemId, token) => getFileMetadata(itemId, token),
  buildDownloadUrl: (args) =>
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(args.itemId)}?alt=media&supportsAllDrives=true`,
  runImport: (sql, args) =>
    importFiles(
      args,
      createSyncImportDeps(sql, GOOGLE_DRIVE_SYNC_ADAPTER, args.organizationId),
    ),
};

/** The pg dependency object for the Google Drive import route. */
export function createGoogleDriveImportDeps(
  sql: Sql,
  organizationId: string,
): PgSyncImportDeps {
  return createSyncImportDeps(sql, GOOGLE_DRIVE_SYNC_ADAPTER, organizationId);
}

export async function cancelSyncConfig(
  db: Sql | TransactionSql,
  organizationId: string,
  configId: string,
): Promise<void> {
  await cancelSyncConfigRow(
    db,
    GOOGLE_DRIVE_CONFIG_TABLE,
    organizationId,
    configId,
  );
}

export async function runGoogleDriveSyncScan(sql: Sql): Promise<number> {
  return runSyncScanWith(sql, GOOGLE_DRIVE_SYNC_ADAPTER);
}

export async function runGoogleDriveSyncConfigJob(
  sql: Sql,
  payload: { organizationId: string; configId: string },
): Promise<void> {
  await runSyncConfigJobWith(sql, GOOGLE_DRIVE_SYNC_ADAPTER, payload);
}
