/**
 * Import Google Drive files into Knowledge Documents (one-time or sync).
 */

import { resolveFileType } from '../../../lib/shared/file-types';
import {
  isSourceUnchanged,
  sourceFingerprint,
} from '../cloud_import/source_fingerprint';
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
  /** Vendor last-modified, ms — with `size`, the change key when the
   *  vendor sent no hash. */
  modifiedAt?: number;
}

export interface ImportFilesDependencies {
  getFileMetadata: (
    itemId: string,
    token: string,
  ) => Promise<{ success: boolean; data?: FileMetadata; error?: string }>;
  downloadToStorage: (args: { itemId: string; token: string }) => Promise<{
    success: boolean;
    storageId?: BlobRef;
    mimeType?: string;
    size?: number;
    error?: string;
  }>;
  findDocumentByExternalId: (args: {
    organizationId: string;
    externalItemId: string;
  }) => Promise<{
    _id: Id<'documents'>;
    contentHash?: string;
    /** The stored metadata — read for the sync binding it may carry. */
    metadata?: Record<string, unknown> | null;
    /** The hub folder the document sits in (`null` at the root); a sync
     *  import moves an adopted document into its selected folder when the
     *  two differ. Absent when the caller does not track placement. */
    folderId?: string | null;
  } | null>;
  createDocument: (args: {
    organizationId: string;
    title: string;
    fileId: BlobRef;
    mimeType?: string;
    sourceProvider: 'google_drive';
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
    sourceProvider: 'google_drive';
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
    parentId?: string,
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
  scheduleHubDocumentRagIndexing?: (
    documentId: Id<'documents'>,
  ) => Promise<void>;
  /**
   * Bind an already-imported document to a sync config without touching its
   * content — a merge into its metadata. A "Sync import" over a file an
   * earlier one-time import already brought in, unchanged, adopts it this
   * way, so the config updates and prunes it from now on.
   */
  bindDocumentToSync?: (args: {
    documentId: Id<'documents'>;
    metadata: Record<string, unknown>;
  }) => Promise<void>;
  /**
   * Re-file a document the sync adopted UNCHANGED into the folder its
   * selection names — the folder is created on the new/changed path only,
   * so a file that was already in the hub (an earlier one-time import at
   * the root, a directly picked file) used to stay where it was, and a
   * folder whose every file was adopted never existed at all.
   */
  setDocumentFolder?: (args: {
    documentId: Id<'documents'>;
    folderId: Id<'folders'>;
  }) => Promise<void>;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The keys that describe the user's selection an import item came from. */
function selectionOf(item: ImportItem): Record<string, unknown> {
  return {
    ...(item.selectedParentId && { selectedParentId: item.selectedParentId }),
    ...(item.selectedParentName && {
      selectedParentName: item.selectedParentName,
    }),
    ...(item.selectedParentPath && {
      selectedParentPath: item.selectedParentPath,
    }),
    ...(item.isDirectlySelected !== undefined && {
      isDirectlySelected: item.isDirectlySelected,
    }),
  };
}

const SYNC_SELECTION_KEYS = [
  'selectedParentId',
  'selectedParentName',
  'selectedParentPath',
  'isDirectlySelected',
] as const;

/**
 * The binding a sync-owned document already carries, so a one-time re-import
 * of the same file does not detach it: the config keeps updating and pruning
 * it, and the selection keys stay so the trash lane can still stop a
 * single-file sync. Empty for a manual document.
 */
function inheritedSyncBinding(
  existingMeta: Record<string, unknown>,
): Record<string, unknown> {
  if (
    existingMeta.sourceMode !== 'auto' ||
    typeof existingMeta.syncConfigId !== 'string'
  ) {
    return {};
  }
  const kept: Record<string, unknown> = {
    sourceMode: 'auto',
    syncConfigId: existingMeta.syncConfigId,
  };
  for (const key of SYNC_SELECTION_KEYS) {
    if (existingMeta[key] !== undefined) kept[key] = existingMeta[key];
  }
  return kept;
}

export async function importFiles(
  args: {
    items: ImportItem[];
    organizationId: string;
    importType: 'one-time' | 'sync';
    teamId?: string;
    /** The hub folder the import lands in — the folder the person had open.
     *  Undefined imports at the hub root, which is what every import did
     *  before: placement came only from mirroring the provider's own path,
     *  so files picked at the top of the picker had no path to mirror and
     *  landed at the root whatever folder was on screen. */
    destinationFolderId?: string;
    token: string;
    userId: string;
  },
  deps: ImportFilesDependencies,
): Promise<ImportFilesResult> {
  const results: ImportFileResult[] = [];
  let successCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

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
      // The sync root exists from the moment the config does — the row a
      // person stops the sync from — even when every file below it is
      // adopted unchanged and the per-file lane never creates a folder.
      if (target.itemType === 'folder' && deps.getOrCreateFolderPath) {
        try {
          await deps.getOrCreateFolderPath(
            args.organizationId,
            (target.itemPath || target.itemName).split('/'),
            args.userId,
            args.teamId,
            args.destinationFolderId,
          );
        } catch (error) {
          console.warn(
            `[importFiles] could not create the sync root for "${target.itemName}":`,
            error,
          );
        }
      }
    }
  }

  /** The hub folder the item's path names — created on demand — or
   *  `undefined` when the path has no folder part. */
  const intendedFolderId = async (
    item: ImportItem,
  ): Promise<Id<'folders'> | undefined> => {
    const destination = args.destinationFolderId as Id<'folders'> | undefined;
    if (!deps.getOrCreateFolderPath || !item.relativePath) return destination;
    const segments = item.relativePath.split('/').slice(0, -1);
    if (segments.length === 0) return destination;
    return deps.getOrCreateFolderPath(
      args.organizationId,
      segments,
      args.userId,
      args.teamId,
      args.destinationFolderId,
    );
  };

  for (const item of args.items) {
    try {
      const existingDoc = await deps.findDocumentByExternalId({
        organizationId: args.organizationId,
        externalItemId: item.id,
      });

      const metadataResult = await deps.getFileMetadata(item.id, args.token);
      if (!metadataResult.success || !metadataResult.data) {
        throw new Error(metadataResult.error || 'Failed to get file metadata');
      }

      const contentHash = metadataResult.data.hash;
      const syncConfigId = configIdByItemId.get(
        item.selectedParentId ?? item.id,
      );
      const existingMeta = isRecord(existingDoc?.metadata)
        ? existingDoc.metadata
        : {};

      // Unchanged by hash, or — when the vendor sent none — by the stamped
      // size + modified fingerprint; a file with neither re-downloads.
      const fingerprint = sourceFingerprint(metadataResult.data);
      if (
        existingDoc &&
        isSourceUnchanged({
          hash: contentHash,
          storedHash: existingDoc.contentHash,
          fingerprint,
          storedFingerprint: existingMeta.sourceFingerprint,
        })
      ) {
        // Unchanged — but a sync import still adopts a document an earlier
        // one-time import left unbound; otherwise the config would neither
        // track nor prune it until its content happened to change.
        const boundToThisSync =
          existingMeta.syncConfigId === syncConfigId &&
          existingMeta.sourceMode === 'auto';
        if (syncConfigId !== undefined && !boundToThisSync) {
          await deps.bindDocumentToSync?.({
            documentId: existingDoc._id,
            metadata: {
              sourceMode: 'auto',
              syncConfigId,
              ...selectionOf(item),
            },
          });
        }
        // A sync import files the document where its selection says, even
        // when the bytes did not change: the folder row is what the person
        // stops the sync from. Only INTO a folder — a path without a folder
        // part keeps a manual move, the way the changed path does.
        if (syncConfigId !== undefined && deps.setDocumentFolder) {
          const folderId = await intendedFolderId(item);
          if (
            folderId !== undefined &&
            existingDoc.folderId !== undefined &&
            existingDoc.folderId !== folderId
          ) {
            await deps.setDocumentFolder({
              documentId: existingDoc._id,
              folderId,
            });
          }
        }
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
      });
      if (!stored.success || !stored.storageId) {
        throw new Error(stored.error || 'Failed to download file');
      }

      const storageId = stored.storageId;
      const contentType = resolveFileType(
        item.name,
        stored.mimeType || 'application/octet-stream',
      );
      const fileSize = stored.size ?? metadataResult.data.size ?? item.size;
      const storagePath = item.relativePath
        ? `${args.organizationId}/${item.relativePath}`
        : `${args.organizationId}/${item.name}`;

      const metadata: Record<string, unknown> = {
        googleDriveItemId: item.id,
        itemPath: item.relativePath || '',
        sourceMode: args.importType === 'sync' ? 'auto' : 'manual',
        storagePath,
        size: fileSize,
        ...(fingerprint !== undefined && { sourceFingerprint: fingerprint }),
        ...(syncConfigId && { syncConfigId }),
        ...selectionOf(item),
        // A one-time re-import of a file a sync config owns must not detach
        // it (the metadata is written whole, so the binding has to be
        // carried over explicitly).
        ...(syncConfigId === undefined
          ? inheritedSyncBinding(existingMeta)
          : {}),
      };

      const folderId = await intendedFolderId(item);

      let documentId: Id<'documents'>;
      if (existingDoc) {
        await deps.updateDocument({
          documentId: existingDoc._id,
          title: item.name,
          fileId: storageId,
          mimeType: contentType,
          sourceProvider: 'google_drive',
          externalItemId: item.id,
          contentHash,
          teamId: args.teamId,
          metadata,
          folderId,
        });
        documentId = existingDoc._id;
      } else {
        documentId = await deps.createDocument({
          organizationId: args.organizationId,
          title: item.name,
          fileId: storageId,
          mimeType: contentType,
          sourceProvider: 'google_drive',
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
      console.error(`[google_drive.importFiles] Failed ${item.name}:`, error);
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
