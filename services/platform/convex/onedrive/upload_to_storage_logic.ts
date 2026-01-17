/**
 * Upload to Storage Logic - Business logic for uploading files to Convex storage
 */

import type { ActionCtx } from '../_generated/server';

export interface UploadToStorageResult {
  success: boolean;
  storageId?: string;
  error?: string;
}

export interface UploadToStorageDependencies {
  storageStore: ActionCtx['storage']['store'];
}

/**
 * Upload file content to Convex storage
 */
export async function uploadToStorageLogic(
  args: {
    fileName: string;
    fileContent: ArrayBuffer | string;
    contentType?: string;
    storagePath: string;
    metadata?: Record<string, unknown>;
  },
  deps: UploadToStorageDependencies,
): Promise<UploadToStorageResult> {
  try {
    // Convert content to Blob
    let blob: Blob;
    if (typeof args.fileContent === 'string') {
      blob = new Blob([args.fileContent], {
        type: args.contentType || 'text/plain',
      });
    } else {
      blob = new Blob([args.fileContent], {
        type: args.contentType || 'application/octet-stream',
      });
    }

    // Store in Convex storage
    const storageId = await deps.storageStore(blob);

    return {
      success: true,
      storageId,
    };
  } catch (error) {
    console.error('uploadToStorageLogic error:', error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Unknown error uploading to storage',
    };
  }
}

