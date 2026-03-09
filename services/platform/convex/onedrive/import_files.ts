/**
 * Import Files - Business logic for importing files from OneDrive/SharePoint
 */

import type { Id } from '../_generated/dataModel';

export interface ImportItem {
  id: string;
  name: string;
  size: number;
  relativePath?: string;
  isDirectlySelected?: boolean;
  selectedParentId?: string;
  selectedParentName?: string;
  selectedParentPath?: string;
  siteId?: string;
  driveId?: string;
  sourceType?: 'onedrive' | 'sharepoint';
}

export interface ImportFileResult {
  fileId: string;
  fileName: string;
  status: 'success' | 'skipped' | 'error';
  documentId?: Id<'documents'>;
  error?: string;
}

export interface ImportFilesResult {
  success: boolean;
  results: ImportFileResult[];
  totalFiles: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  error?: string;
}

interface FileMetadata {
  hash?: string;
  mimeType?: string;
  size?: number;
}

export interface ImportFilesDependencies {
  getFileMetadata: (
    itemId: string,
    token: string,
    siteId?: string,
    driveId?: string,
  ) => Promise<{ success: boolean; data?: FileMetadata; error?: string }>;
  downloadFile: (
    itemId: string,
    token: string,
    siteId?: string,
    driveId?: string,
  ) => Promise<{
    success: boolean;
    content?: ArrayBuffer;
    mimeType?: string;
    error?: string;
  }>;
  findDocumentByExternalId: (args: {
    organizationId: string;
    externalItemId: string;
  }) => Promise<{ _id: Id<'documents'>; contentHash?: string } | null>;
  storeFile: (blob: Blob) => Promise<Id<'_storage'>>;
  createDocument: (args: {
    organizationId: string;
    title: string;
    fileId: Id<'_storage'>;
    sourceProvider: 'onedrive' | 'sharepoint';
    externalItemId: string;
    contentHash?: string;
    teamId?: string;
    metadata?: Record<string, unknown>;
    createdBy?: string;
    folderId?: Id<'folders'>;
  }) => Promise<Id<'documents'>>;
  updateDocument: (args: {
    documentId: Id<'documents'>;
    title: string;
    fileId: Id<'_storage'>;
    sourceProvider: 'onedrive' | 'sharepoint';
    externalItemId: string;
    contentHash?: string;
    teamId?: string;
    metadata?: Record<string, unknown>;
    folderId?: Id<'folders'>;
  }) => Promise<void>;
  getOrCreateFolderPath?: (
    organizationId: string,
    pathSegments: string[],
    createdBy?: string,
    teamId?: string,
  ) => Promise<Id<'folders'> | undefined>;
  saveFileMetadata: (
    storageId: Id<'_storage'>,
    fileName: string,
    contentType: string,
    size: number,
  ) => Promise<void>;
}

export async function importFiles(
  args: {
    items: ImportItem[];
    organizationId: string;
    importType: 'one-time' | 'sync';
    teamId?: string;
    token: string;
    userId: string;
  },
  deps: ImportFilesDependencies,
): Promise<ImportFilesResult> {
  const results: ImportFileResult[] = [];
  let successCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  for (const item of args.items) {
    try {
      const sourceProvider = item.sourceType ?? 'onedrive';

      const existingDoc = await deps.findDocumentByExternalId({
        organizationId: args.organizationId,
        externalItemId: item.id,
      });

      const metadataResult = await deps.getFileMetadata(
        item.id,
        args.token,
        item.siteId,
        item.driveId,
      );

      if (!metadataResult.success || !metadataResult.data) {
        throw new Error(metadataResult.error || 'Failed to get file metadata');
      }

      const contentHash = metadataResult.data.hash;

      if (
        existingDoc &&
        contentHash &&
        existingDoc.contentHash === contentHash
      ) {
        results.push({
          fileId: item.id,
          fileName: item.name,
          status: 'skipped',
          documentId: existingDoc._id,
        });
        skippedCount++;
        continue;
      }

      const downloadResult = await deps.downloadFile(
        item.id,
        args.token,
        item.siteId,
        item.driveId,
      );

      if (!downloadResult.success || !downloadResult.content) {
        throw new Error(downloadResult.error || 'Failed to download file');
      }

      const blob = new Blob([downloadResult.content], {
        type: downloadResult.mimeType || 'application/octet-stream',
      });
      const storageId = await deps.storeFile(blob);
      await deps.saveFileMetadata(
        storageId,
        item.name,
        downloadResult.mimeType || 'application/octet-stream',
        blob.size,
      );

      const storagePath = item.relativePath
        ? `${args.organizationId}/${item.relativePath}`
        : `${args.organizationId}/${item.name}`;

      const metadata: Record<string, unknown> = {
        oneDriveItemId: item.id,
        itemPath: item.relativePath || '',
        sourceMode: args.importType === 'sync' ? 'auto' : 'manual',
        storagePath,
        size: item.size,
        ...(item.selectedParentId && {
          selectedParentId: item.selectedParentId,
        }),
        ...(item.selectedParentName && {
          selectedParentName: item.selectedParentName,
        }),
        ...(item.selectedParentPath && {
          selectedParentPath: item.selectedParentPath,
        }),
        ...(item.isDirectlySelected !== undefined && {
          isDirectlySelected: item.isDirectlySelected,
        }),
        ...(item.siteId && { siteId: item.siteId }),
        ...(item.driveId && { driveId: item.driveId }),
      };

      let folderId: Id<'folders'> | undefined;
      if (deps.getOrCreateFolderPath && item.relativePath) {
        const segments = item.relativePath.split('/').slice(0, -1);
        if (segments.length > 0) {
          folderId = await deps.getOrCreateFolderPath(
            args.organizationId,
            segments,
            args.userId,
            args.teamId,
          );
        }
      }

      let documentId: Id<'documents'>;

      if (existingDoc) {
        await deps.updateDocument({
          documentId: existingDoc._id,
          title: item.name,
          fileId: storageId,
          sourceProvider,
          externalItemId: item.id,
          contentHash,
          metadata,
          teamId: args.teamId,
          folderId,
        });
        documentId = existingDoc._id;
      } else {
        documentId = await deps.createDocument({
          organizationId: args.organizationId,
          title: item.name,
          fileId: storageId,
          sourceProvider,
          externalItemId: item.id,
          contentHash,
          teamId: args.teamId,
          metadata,
          createdBy: args.userId,
          folderId,
        });
      }

      results.push({
        fileId: item.id,
        fileName: item.name,
        status: 'success',
        documentId,
      });
      successCount++;
    } catch (error) {
      console.error(`[importFiles] Failed to process ${item.name}:`, error);

      results.push({
        fileId: item.id,
        fileName: item.name,
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      failedCount++;
    }
  }

  return {
    success: failedCount === 0,
    results,
    totalFiles: args.items.length,
    successCount,
    failedCount,
    skippedCount,
  };
}
