/**
 * Import Files - Business logic for importing files from OneDrive/SharePoint
 */

import { resolveFileType } from '../../../lib/shared/file-types';
import type { Id } from '../lib/rows';
import type { BlobRef } from '../lib/storage/blob_ref';
import { deriveSyncTargets, type SyncTarget } from './derive_sync_targets';

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
  /**
   * Download the source file and land it in org storage in one step,
   * returning only the storage id — the bytes never come back into the
   * caller's heap. The pg lane behind it refuses a file past the platform's
   * blob ceiling before buffering it (declared length first, received bytes
   * second) and times a stalled download out, so one oversized vendor file
   * fails its own row instead of the worker.
   */
  downloadToStorage: (args: {
    itemId: string;
    token: string;
    siteId?: string;
    driveId?: string;
  }) => Promise<{
    success: boolean;
    storageId?: BlobRef;
    mimeType?: string;
    size?: number;
    error?: string;
  }>;
  findDocumentByExternalId: (args: {
    organizationId: string;
    externalItemId: string;
  }) => Promise<{ _id: Id<'documents'>; contentHash?: string } | null>;
  createDocument: (args: {
    organizationId: string;
    title: string;
    fileId: BlobRef;
    mimeType?: string;
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
    fileId: BlobRef;
    mimeType?: string;
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
  /** Queue RAG indexing after the document row and folder path exist. */
  scheduleHubDocumentRagIndexing?: (
    documentId: Id<'documents'>,
  ) => Promise<void>;
  /** Create-or-reactivate the sync config for a selected item ("Sync import"
   *  only). Returns the config id so imported documents can point back at it. */
  upsertSyncConfig?: (
    target: SyncTarget & {
      organizationId: string;
      userId: string;
      teamId?: string;
      targetBucket: string;
      storagePrefix?: string;
    },
  ) => Promise<string | null>;
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

  // "Sync import" registers each selected item as a sync config before any
  // file lands, so the sync workflow keeps the selection fresh afterwards.
  // Imported documents carry the config id in metadata (syncConfigId) — the
  // link the engine uses to update and prune them on later runs.
  const configIdByItemId = new Map<string, string>();
  if (args.importType === 'sync' && deps.upsertSyncConfig) {
    for (const target of deriveSyncTargets(args.items)) {
      const configId = await deps.upsertSyncConfig({
        ...target,
        organizationId: args.organizationId,
        userId: args.userId,
        teamId: args.teamId,
        targetBucket: 'documents',
        storagePrefix: target.itemPath
          ? `${args.organizationId}/${target.itemPath}`
          : args.organizationId,
      });
      if (configId) configIdByItemId.set(target.itemId, configId);
    }
  }

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
        await deps.scheduleHubDocumentRagIndexing?.(existingDoc._id);
        results.push({
          fileId: item.id,
          fileName: item.name,
          status: 'skipped',
          documentId: existingDoc._id,
        });
        skippedCount++;
        continue;
      }

      const stored = await deps.downloadToStorage({
        itemId: item.id,
        token: args.token,
        siteId: item.siteId,
        driveId: item.driveId,
      });

      if (!stored.success || !stored.storageId) {
        throw new Error(stored.error || 'Failed to download file');
      }

      const storageId = stored.storageId;
      const contentType = resolveFileType(
        item.name,
        stored.mimeType || 'application/octet-stream',
      );
      // Size, most-reliable first: the transferred byte count, then the Graph
      // item-metadata size (always present for a file), then the listing size.
      // A recursive listing can omit `size` for a freshly copied/uploaded item
      // (list_folder_contents forwards it verbatim); without this fallback the
      // row's metadata.size stays undefined and the hub renders it as "—".
      const fileSize = stored.size ?? metadataResult.data.size ?? item.size;

      const storagePath = item.relativePath
        ? `${args.organizationId}/${item.relativePath}`
        : `${args.organizationId}/${item.name}`;

      const syncConfigId = configIdByItemId.get(
        item.selectedParentId ?? item.id,
      );

      const metadata: Record<string, unknown> = {
        oneDriveItemId: item.id,
        itemPath: item.relativePath || '',
        sourceMode: args.importType === 'sync' ? 'auto' : 'manual',
        storagePath,
        size: fileSize,
        ...(syncConfigId && { syncConfigId }),
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
          mimeType: contentType,
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
          mimeType: contentType,
          sourceProvider,
          externalItemId: item.id,
          contentHash,
          teamId: args.teamId,
          metadata,
          createdBy: args.userId,
          folderId,
        });
      }

      await deps.saveFileMetadata(
        storageId,
        item.name,
        contentType,
        fileSize,
        documentId,
      );

      await deps.linkDocumentToFile?.(storageId, documentId);

      await deps.scheduleHubDocumentRagIndexing?.(documentId);

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
