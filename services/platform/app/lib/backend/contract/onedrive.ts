/**
 * `onedrive` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../onedrive.ts` are what
 * actually serve them.
 */

export interface OnedriveContract {
  'onedrive/actions:importFiles': {
    kind: 'action';
    args: {
      teamId?: string;
      organizationId: string;
      items: Array<{
        siteId?: string;
        driveId?: string;
        isDirectlySelected?: boolean;
        sourceType?: 'onedrive' | 'sharepoint';
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
  'onedrive/actions:listFiles': {
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
        childCount?: number;
        webUrl?: string;
      }>;
      /** The bound cut the listing — the folder holds more than `items`. */
      truncated?: boolean;
      error?: string;
    };
  };
  'onedrive/actions:listSharePointDrives': {
    kind: 'action';
    args: { organizationId: string; siteId: string };
    returns: {
      success: boolean;
      drives?: Array<{
        id: string;
        name: string;
        driveType: string;
        webUrl?: string;
        description?: string;
      }>;
      error?: string;
    };
  };
  'onedrive/actions:listSharePointFiles': {
    kind: 'action';
    args: {
      folderId?: string;
      organizationId: string;
      siteId: string;
      driveId: string;
    };
    returns: {
      success: boolean;
      items?: Array<{
        id: string;
        name: string;
        size: number;
        isFolder: boolean;
        mimeType?: string;
        lastModified?: number;
        childCount?: number;
        webUrl?: string;
      }>;
      /** The bound cut the listing — the folder holds more than `items`. */
      truncated?: boolean;
      error?: string;
    };
  };
  'onedrive/actions:listSharePointSites': {
    kind: 'action';
    args: { search?: string; organizationId: string };
    returns: {
      success: boolean;
      sites?: Array<{
        id: string;
        name: string;
        displayName: string;
        webUrl: string;
        description?: string;
      }>;
      error?: string;
    };
  };
  'onedrive/mutations:cancelSyncConfig': {
    kind: 'mutation';
    args: { configId: string };
    returns: null;
  };
}
