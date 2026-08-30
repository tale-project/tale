/**
 * `google_drive` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../google_drive.ts` are what
 * actually serve them.
 */

export interface GoogleDriveContract {
  'google_drive/actions:importFiles': {
    kind: 'action';
    args: {
      teamId?: string;
      organizationId: string;
      items: Array<{
        isDirectlySelected?: boolean;
        relativePath?: string;
        selectedParentId?: string;
        selectedParentName?: string;
        selectedParentPath?: string;
        id: string;
        name: string;
        size: number;
      }>;
      importType: 'one-time' | 'sync';
    };
    returns: {
      success: boolean;
      results: Array<{
        fileId: string;
        fileName: string;
        status: 'success' | 'error' | 'skipped';
        documentId?: string;
        error?: string;
      }>;
      totalFiles: number;
      successCount: number;
      failedCount: number;
      skippedCount: number;
      error?: string;
    };
  };
  'google_drive/actions:listFiles': {
    kind: 'action';
    args: { search?: string; folderId?: string; organizationId: string };
    returns: {
      success: boolean;
      items?: Array<{
        id: string;
        name: string;
        size: number;
        isFolder: boolean;
        mimeType?: string;
        lastModified?: number;
        webUrl?: string;
      }>;
      error?: string;
    };
  };
  'google_drive/mutations:cancelSyncConfig': {
    kind: 'mutation';
    args: { configId: string };
    returns: null;
  };
}
