/**
 * Reconcile one synced OneDrive folder: run the shared import pipeline for
 * adds/updates, then prune documents whose source files left the folder.
 *
 * Extracted from the `sync_folder_files` workflow op so both the legacy
 * per-config workflow path and the "sync all active configs" run share one
 * implementation (no divergent second copy of the prune diff).
 */

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';
import type { DocumentRecord, DocumentMetadata } from '../documents/types';
import { importFiles } from './import_files';
import { createImportFilesDeps } from './import_files_deps';
import type { FileItem } from './list_folder_contents';
import { scheduleSyncedDocumentDeletes } from './prune_synced_documents';
import {
  buildSyncImportItems,
  selectDocumentsToPrune,
  type SyncedDocumentRef,
} from './reconcile_folder_sync';

export interface ReconcileFolderResult {
  created: number;
  updated: number;
  skipped: number;
  deleted: number;
  errorsCount: number;
}

/**
 * Sync a folder config's files into the hub and delete documents whose source
 * files disappeared. Only auto-synced documents owned by this config are pruned.
 */
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

  // Prune documents whose source files left the synced folder.
  const existingDocs: SyncedDocumentRef[] = [];
  let cursor: string | null = null;
  while (true) {
    const res: {
      page: DocumentRecord[];
      isDone: boolean;
      continueCursor: string;
    } = await ctx.runQuery(internal.documents.internal_queries.queryDocuments, {
      organizationId: args.organizationId,
      sourceProvider: 'onedrive',
      paginationOpts: { numItems: 100, cursor },
    });
    for (const doc of res.page) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- metadata stored via v.any(); shape is DocumentMetadata written by our sync code
      const meta = (doc.metadata ?? {}) as DocumentMetadata;
      existingDocs.push({
        documentId: doc._id,
        externalItemId:
          doc.externalItemId ?? meta.oneDriveItemId ?? meta.oneDriveId,
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

  // Resolve the sync target root so each prune can reap the now-empty
  // subfolders it leaves behind (a subdir deleted at the source), stopping
  // at — and never deleting — the synced root itself. Mirrors the
  // drive-reconcile path in document_action.ts. The root path is the same
  // one `buildSyncImportItems` roots documents at. Read-only lookup: a
  // missing root means no synced docs (nor folders) exist to reap.
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

  // Delete each orphan through the shared prune path (RAG-purging for
  // blob-bearing docs, direct for metadata-only), which reaps the emptied
  // ancestor folders up to the sync root.
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
