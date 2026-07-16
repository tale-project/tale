/**
 * Upload and Create Document - Orchestrates storage upload and document creation
 */

import type { Id } from '../_generated/dataModel';
import type { BlobRef } from '../lib/storage/blob_ref';

export interface OneDriveMetadata extends Record<string, unknown> {
  oneDriveItemId?: string;
  oneDriveId?: string;
}

export interface UploadAndCreateDocResult {
  success: boolean;
  fileId?: BlobRef;
  documentId?: Id<'documents'>;
  error?: string;
}

export interface UploadAndCreateDocDependencies {
  /** Store the bytes for the org and return the blob reference (a Convex
   *  `_storage` id or an `s3:` ref when the org has its own bucket). */
  storageStore: (blob: Blob) => Promise<BlobRef>;
  createDocument: (args: {
    organizationId: string;
    title: string;

    fileId: BlobRef;
    mimeType?: string;
    metadata: Record<string, unknown>;
    sourceProvider?: 'onedrive' | 'upload';
    externalItemId?: string;
    createdBy?: string;
  }) => Promise<{ documentId?: Id<'documents'> }>;
  updateDocument: (args: {
    documentId: Id<'documents'>;
    title: string;
    fileId: BlobRef;
    mimeType?: string;
    metadata: Record<string, unknown>;
    sourceProvider?: 'onedrive' | 'upload';
    externalItemId?: string;
  }) => Promise<void>;
  saveFileMetadata: (
    storageId: BlobRef,
    fileName: string,
    contentType: string,
    size: number,
    documentId: Id<'documents'>,
  ) => Promise<void>;
  linkDocumentToFile?: (
    storageId: BlobRef,
    documentId: Id<'documents'>,
  ) => Promise<void>;
  scheduleHubDocumentRagIndexing?: (
    documentId: Id<'documents'>,
  ) => Promise<void>;
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

      await deps.saveFileMetadata(
        storageId,
        args.fileName,
        args.contentType || 'application/octet-stream',
        blob.size,
        args.documentIdToUpdate,
      );

      await deps.linkDocumentToFile?.(storageId, args.documentIdToUpdate);
      await deps.scheduleHubDocumentRagIndexing?.(args.documentIdToUpdate);

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

    if (documentId) {
      await deps.saveFileMetadata(
        storageId,
        args.fileName,
        args.contentType || 'application/octet-stream',
        blob.size,
        documentId,
      );
      await deps.linkDocumentToFile?.(storageId, documentId);
      await deps.scheduleHubDocumentRagIndexing?.(documentId);
    }

    return { success: true, fileId: storageId, documentId };
  } catch (error) {
    console.error('uploadAndCreateDocument error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
