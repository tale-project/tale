/**
 * Build the version list for a document: current `fileId` first, then
 * `historyFiles` newest-previous → oldest. Timestamps and file metadata come
 * from `fileMetadata` when present (upsert keeps prior blobs + their rows).
 */

import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

export type DocumentVersionEntry = {
  storageId: Id<'_storage'>;
  createdAt: number;
  isCurrent: boolean;
  fileName?: string;
  size?: number;
  contentType?: string;
};

export async function listDocumentVersionsForDoc(
  ctx: QueryCtx,
  doc: Doc<'documents'>,
): Promise<DocumentVersionEntry[]> {
  const history = doc.historyFiles ?? [];
  const ordered: Array<{ storageId: Id<'_storage'>; isCurrent: boolean }> = [];
  const seen = new Set<string>();

  if (doc.fileId) {
    ordered.push({ storageId: doc.fileId, isCurrent: true });
    seen.add(doc.fileId);
  }

  // historyFiles appends the previous blob on each content replace — oldest
  // first. Reverse so the list after current is newest-previous → oldest.
  for (let i = history.length - 1; i >= 0; i--) {
    const storageId = history[i];
    if (!storageId || seen.has(storageId)) continue;
    seen.add(storageId);
    ordered.push({ storageId, isCurrent: false });
  }

  const versions: DocumentVersionEntry[] = [];
  for (const entry of ordered) {
    const meta = await ctx.db
      .query('fileMetadata')
      .withIndex('by_storageId', (q) => q.eq('storageId', entry.storageId))
      .first();
    versions.push({
      storageId: entry.storageId,
      createdAt: meta?._creationTime ?? doc._creationTime,
      isCurrent: entry.isCurrent,
      fileName: meta?.fileName,
      size: meta?.size,
      contentType: meta?.contentType,
    });
  }
  return versions;
}
