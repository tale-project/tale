/**
 * Reconcile one synced Google Drive folder: import pipeline for adds/updates,
 * then prune documents whose source files left the folder.
 */

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';
import type { DocumentRecord, DocumentMetadata } from '../documents/types';
import { scheduleSyncedDocumentDeletes } from '../onedrive/prune_synced_documents';
import {
  buildSyncImportItems,
  selectDocumentsToPrune,
  type SyncedDocumentRef,
} from '../onedrive/reconcile_folder_sync';
import { importFiles } from './import_files';
import { createImportFilesDeps } from './import_files_deps';
import type { FileItem } from './list_folder_contents';

export interface ReconcileFolderResult {
  created: number;
  updated: number;
  skipped: number;
  deleted: number;
  errorsCount: number;
}

export async function reconcileFolder(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    configId: string;
    itemId: string;
    itemName: string;
    itemPath?: string;
    userId: string;
    teamId?: string;
    files: FileItem[];
    token: string;
  },
): Promise<ReconcileFolderResult> {
  const items = buildSyncImportItems(
    {
      configId: args.configId,
      itemId: args.itemId,
      itemName: args.itemName,
      itemPath: args.itemPath,
    },
    args.files,
  );

  const importResult = await importFiles(
    {
      items,
      organizationId: args.organizationId,
      importType: 'sync',
      teamId: args.teamId,
      token: args.token,
      userId: args.userId,
    },
    createImportFilesDeps(ctx, args.organizationId),
  );

  const existingDocs: SyncedDocumentRef[] = [];
  let cursor: string | null = null;
  while (true) {
    const res: {
      page: DocumentRecord[];
      isDone: boolean;
      continueCursor: string;
    } = await ctx.runQuery(internal.documents.internal_queries.queryDocuments, {
      organizationId: args.organizationId,
      sourceProvider: 'google_drive',
      paginationOpts: { numItems: 100, cursor },
    });
    for (const doc of res.page) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- metadata stored via v.any(); shape is DocumentMetadata written by our sync code
      const meta = (doc.metadata ?? {}) as DocumentMetadata;
      existingDocs.push({
        documentId: doc._id,
        externalItemId:
          doc.externalItemId ?? meta.googleDriveItemId ?? meta.googleDriveId,
        syncConfigId: meta.syncConfigId,
        sourceMode: meta.sourceMode,
        fileId: doc.fileId,
      });
    }
    if (res.isDone) break;
    cursor = res.continueCursor || null;
  }

  const toPrune = selectDocumentsToPrune(
    args.configId,
    new Set(args.files.map((f) => f.id)),
    existingDocs,
  );
  const refById = new Map(existingDocs.map((doc) => [doc.documentId, doc]));

  const rootSegments = (args.itemPath || args.itemName)
    .split('/')
    .filter((s) => s.trim().length > 0);
  const cleanupAncestorsUpTo: Id<'folders'> | undefined =
    toPrune.length > 0 && rootSegments.length > 0
      ? ((await ctx.runQuery(
          internal.folders.internal_queries.findFolderByPath,
          { organizationId: args.organizationId, pathSegments: rootSegments },
        )) ?? undefined)
      : undefined;

  const refsToPrune = toPrune
    .map((documentId) => refById.get(documentId))
    .filter((ref): ref is SyncedDocumentRef => ref !== undefined);
  await scheduleSyncedDocumentDeletes(ctx, {
    organizationId: args.organizationId,
    refs: refsToPrune,
    cleanupAncestorsUpTo,
  });

  const errorsCount = importResult.results.filter(
    (r) => r.status === 'error',
  ).length;

  return {
    created: importResult.successCount,
    updated: 0,
    skipped: importResult.skippedCount,
    deleted: toPrune.length,
    errorsCount,
  };
}
