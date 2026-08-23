/**
 * Reconcile one synced Google Drive file through the shared import pipeline.
 */

import { internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import type { DocumentMetadata } from '../documents/types';
import { scheduleSyncedDocumentDeletes } from '../onedrive/prune_synced_documents';
import type { SyncedDocumentRef } from '../onedrive/reconcile_folder_sync';
import { getFileMetadata } from './get_file_metadata';
import { importFiles, type ImportItem } from './import_files';
import { createImportFilesDeps } from './import_files_deps';

export interface ReconcileSingleFileResult {
  created: number;
  skipped: number;
  deleted: number;
  errorsCount: number;
  sourceDeleted?: boolean;
}

interface SingleFileArgs {
  organizationId: string;
  configId: string;
  itemId: string;
  itemName: string;
  itemPath?: string;
  userId: string;
  teamId?: string;
  token: string;
}

async function collectOwnedRefs(
  ctx: ActionCtx,
  args: SingleFileArgs,
): Promise<SyncedDocumentRef[]> {
  const rows = await ctx.runQuery(
    internal.documents.internal_queries.findDocumentsByExternalId,
    { organizationId: args.organizationId, externalItemId: args.itemId },
  );
  return rows
    .filter((doc) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- metadata stored via v.any(); shape is DocumentMetadata written by our sync code
      const meta = (doc.metadata ?? {}) as DocumentMetadata;
      return meta.syncConfigId === args.configId && meta.sourceMode === 'auto';
    })
    .map((doc) => ({
      documentId: doc._id,
      externalItemId: doc.externalItemId,
      fileId: doc.fileId,
    }));
}

export async function reconcileSingleFile(
  ctx: ActionCtx,
  args: SingleFileArgs,
): Promise<ReconcileSingleFileResult> {
  const item: ImportItem = {
    id: args.itemId,
    name: args.itemName,
    size: 0,
    relativePath: args.itemPath ?? args.itemName,
    isDirectlySelected: true,
  };

  const importResult = await importFiles(
    {
      items: [item],
      organizationId: args.organizationId,
      importType: 'sync',
      teamId: args.teamId,
      token: args.token,
      userId: args.userId,
    },
    createImportFilesDeps(ctx, args.organizationId),
  );

  const primary = importResult.results[0];
  const canonicalId = primary?.documentId;

  if (!canonicalId) {
    const meta = await getFileMetadata(args.itemId, args.token);
    if (!meta.success && meta.notFound) {
      const owned = await collectOwnedRefs(ctx, args);
      await scheduleSyncedDocumentDeletes(ctx, {
        organizationId: args.organizationId,
        refs: owned,
      });
      return {
        created: 0,
        skipped: 0,
        deleted: owned.length,
        errorsCount: 0,
        sourceDeleted: true,
      };
    }
    throw new Error(primary?.error ?? 'Failed to sync file from Google Drive');
  }

  const strays = (await collectOwnedRefs(ctx, args)).filter(
    (ref) => ref.documentId !== canonicalId,
  );
  await scheduleSyncedDocumentDeletes(ctx, {
    organizationId: args.organizationId,
    refs: strays,
  });

  return {
    created: importResult.successCount,
    skipped: importResult.skippedCount,
    deleted: strays.length,
    errorsCount: importResult.results.filter((r) => r.status === 'error')
      .length,
  };
}
