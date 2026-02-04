/**
 * Upload to Storage - Business logic for uploading files to Convex storage
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
export async function uploadToStorage(
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

    const storageId = await deps.storageStore(blob);

    return {
      success: true,
      storageId,
    };
  } catch (error) {
    console.error('uploadToStorage error:', error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Unknown error uploading to storage',
    };
  }
}
