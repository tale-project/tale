/**
 * Type definitions for OneDrive operations
 */

import type { Infer } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import {
  syncConfigStatusValidator,
  onedriveItemTypeValidator,
  driveItemValidator,
  fileItemValidator,
  oneDriveItemValidator,
  importItemValidator,
  importFileResultValidator,
  sharePointSiteValidator,
  sharePointDriveValidator,
} from './validators';

// =============================================================================
// INFERRED TYPES (from validators)
// =============================================================================

export type SyncConfigStatus = Infer<typeof syncConfigStatusValidator>;
export type OnedriveItemType = Infer<typeof onedriveItemTypeValidator>;
export type DriveItem = Infer<typeof driveItemValidator>;
export type FileItem = Infer<typeof fileItemValidator>;
export type OneDriveItem = Infer<typeof oneDriveItemValidator>;
export type ImportItem = Infer<typeof importItemValidator>;
export type ImportFileResult = Infer<typeof importFileResultValidator>;
export type SharePointSite = Infer<typeof sharePointSiteValidator>;
export type SharePointDrive = Infer<typeof sharePointDriveValidator>;

// =============================================================================
// MANUAL TYPES (no corresponding validator)
// =============================================================================

export type OnedriveSyncConfig = Doc<'onedriveSyncConfigs'>;

export interface CreateSyncConfigArgs {
  organizationId: string;
  userId: string;
  itemType: 'file' | 'folder';
  itemId: string;
  itemName: string;
  itemPath?: string;
  targetBucket: string;
  storagePrefix?: string;
  teamTags?: string[];
}

export interface UpdateSyncConfigArgs {
  configId: Id<'onedriveSyncConfigs'>;
  status?: SyncConfigStatus;
  lastSyncAt?: number;
  lastSyncStatus?: string;
  errorMessage?: string;
}
