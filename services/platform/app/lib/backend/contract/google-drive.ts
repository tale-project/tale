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
        /** What failed, for the log — often the provider's own answer. */
        error?: string;
        /** Why the file was refused, in words a person can read; only a
         *  refusal Tale wrote for people carries one. */
        reason?: { code: string; message: string };
      }>;
      totalFiles: number;
      successCount: number;
      failedCount: number;
      skippedCount: number;
      /** The grant check's sentence when access ended (the import stopped
       *  there); the backend's English, never shown. */
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
      /** The bound cut the listing — the folder holds more than `items`. */
      truncated?: boolean;
      error?: string;
    };
  };
  'google_drive/mutations:cancelSyncConfig': {
    kind: 'mutation';
    args: { configId: string };
    returns: null;
  };
}
