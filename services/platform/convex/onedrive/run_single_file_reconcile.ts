/**
 * Reconcile one synced OneDrive file: run the shared import pipeline for the
 * single item (dedup by external id → update the one existing doc in place),
 * collapse any duplicate rows a prior no-dedup sync run created for it, and —
 * when the source file is gone at the origin — remove the mirror.
 *
 * Before this, the single-file config path re-uploaded the file and inserted a
 * brand-new document on every scheduled run (no external-id lookup), so a
 * single synced file accumulated one stray, size-less ("—") duplicate per run,
 * and a deletion at the source was never reflected (the doc lingered while the
 * config silently errored). Routing it through `importFiles` gives it the same
 * dedup / content-hash-skip / streaming-download / size handling the folder
 * path has; the heal step reaps strays; and a definitive 404 prunes the mirror
 * the way the folder reconcile prunes a file that left the folder.
 */

import { internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import type { DocumentMetadata } from '../documents/types';
import { getFileMetadata } from './get_file_metadata';
import { importFiles, type ImportItem } from './import_files';
import { createImportFilesDeps } from './import_files_deps';
import { scheduleSyncedDocumentDeletes } from './prune_synced_documents';
import type { SyncedDocumentRef } from './reconcile_folder_sync';

export interface ReconcileSingleFileResult {
  created: number;
  skipped: number;
  deleted: number;
  errorsCount: number;
  /** The source file no longer exists (404): the mirror was removed and the
   *  caller should deactivate the config so it stops retrying. */
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

/**
 * Every auto-synced document this config owns for its file. All point at the
 * same source item, so on a normal run all but the canonical are strays, and
 * on a source deletion all are removed. Manual uploads and other configs'
 * rows (matched only by external id) are excluded.
 */
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
  // One import item for the single tracked file. `importFiles` fetches the
  // Graph metadata itself and resolves the real size, so 0 here is just a
  // placeholder the resolution overrides.
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
    // Import failed. Only a definitive 404 (source deleted/trashed) removes the
    // mirror — a transient / permission / throttle failure keeps the doc and
    // errors the config. Re-read metadata on this rare error path to tell them
    // apart (a move keeps the item id, so this 404 means truly gone).
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
    // Throw so the caller marks the config `error` — and so we never prune with
    // no canonical to keep. Mirrors the old single-file path's throw-on-failure.
    throw new Error(primary?.error ?? 'Failed to sync file from OneDrive');
  }

  // Heal: collapse the duplicate rows a prior no-dedup sync run created for
  // this file, keeping the row we just upserted.
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
