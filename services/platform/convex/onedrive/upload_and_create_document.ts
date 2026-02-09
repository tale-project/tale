/**
 * Upload and Create Document - Orchestrates storage upload and document creation
 */

import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';

export interface OneDriveMetadata extends Record<string, unknown> {
  oneDriveItemId?: string;
  oneDriveId?: string;
}

export interface UploadAndCreateDocResult {
  success: boolean;
  fileId?: Id<'_storage'>;
  documentId?: Id<'documents'>;
  error?: string;
}

export interface UploadAndCreateDocDependencies {
  storageStore: ActionCtx['storage']['store'];
  createDocument: (args: {
    organizationId: string;
    title: string;

    fileId: Id<'_storage'>;
    mimeType?: string;
    metadata: Record<string, unknown>;
    sourceProvider?: 'onedrive' | 'upload';
    externalItemId?: string;
    createdBy?: string;
  }) => Promise<{ documentId?: Id<'documents'> }>;
  updateDocument: (args: {
    documentId: Id<'documents'>;
    title: string;
    fileId: Id<'_storage'>;
    mimeType?: string;
    metadata: Record<string, unknown>;
    sourceProvider?: 'onedrive' | 'upload';
    externalItemId?: string;
  }) => Promise<void>;
}

/**
 * Upload file content to storage and create a document record
 */
export async function uploadAndCreateDocument(
  args: {
    organizationId: string;
    fileName: string;
    fileContent: ArrayBuffer | string;
    contentType: string;
    metadata: OneDriveMetadata;
    documentIdToUpdate?: Id<'documents'>;
    createdBy?: string;
  },
  deps: UploadAndCreateDocDependencies,
): Promise<UploadAndCreateDocResult> {
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

    const externalItemId =
      args.metadata.oneDriveItemId ?? args.metadata.oneDriveId;

    if (args.documentIdToUpdate) {
      await deps.updateDocument({
        documentId: args.documentIdToUpdate,
        title: args.fileName,
        fileId: storageId,
        mimeType: args.contentType,
        metadata: args.metadata,
        sourceProvider: 'onedrive',
        externalItemId,
      });

      return {
        success: true,
        fileId: storageId,
        documentId: args.documentIdToUpdate,
      };
    }

    const { documentId } = await deps.createDocument({
      organizationId: args.organizationId,
      title: args.fileName,

      fileId: storageId,
      mimeType: args.contentType,
      metadata: args.metadata,
      sourceProvider: 'onedrive',
      externalItemId,
      createdBy: args.createdBy,
    });

    return { success: true, fileId: storageId, documentId };
  } catch (error) {
    console.error('uploadAndCreateDocument error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
