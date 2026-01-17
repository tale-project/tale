/**
 * OneDrive sync types
 */

export interface SyncResult {
  success: boolean;
  error?: string;
  syncedFiles: Array<{
    name: string;
    oneDriveId: string;
    storagePath: string;
    size: number;
  }>;
  failedFiles: Array<{
    name: string;
    oneDriveId: string;
    error: string;
  }>;
  totalFiles: number;
  processedCount?: number;
  currentFile?: string;
}

export interface SyncToStorageParams {
  businessId: string;
  selectedItems: Array<{
    id: string;
    name: string;
    size?: number;
  }>;
  folderPrefix?: string;
}
