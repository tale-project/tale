/**
 * Upload and Create Document Logic - Orchestrates storage upload and document creation
 */

import type { ActionCtx } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';

/** Metadata shape for OneDrive documents */
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
export async function uploadAndCreateDocumentLogic(
  args: {
    organizationId: string;
    fileName: string;
    fileContent: ArrayBuffer | string;
    contentType: string;
    metadata: OneDriveMetadata;
    documentIdToUpdate?: Id<'documents'>;
  },
  deps: UploadAndCreateDocDependencies,
): Promise<UploadAndCreateDocResult> {
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

    const externalItemId = args.metadata.oneDriveItemId ?? args.metadata.oneDriveId;

    // If updating an existing document, patch it instead of creating a new one
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

    // Create document record via injected dependency
    const { documentId } = await deps.createDocument({
      organizationId: args.organizationId,
      title: args.fileName,

      fileId: storageId,
      mimeType: args.contentType,
      metadata: args.metadata,
      sourceProvider: 'onedrive',
      externalItemId,
    });

    return { success: true, fileId: storageId, documentId };
  } catch (error) {
    console.error('uploadAndCreateDocumentLogic error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
