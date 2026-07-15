import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { findFolderByPath } from '../folders/find_folder_by_path';
import type { BlobRef } from '../lib/storage/blob_ref';
import { isActiveDocument } from './_helpers';

export interface FolderFile {
  fileId: BlobRef;
  name: string;
}

/**
 * Files DIRECTLY inside one folder (no recursion), addressed by id or by its
 * human-readable documents path ("Clients/Acme GmbH"). Powers the sandbox
 * folder-input staging: only rows with a stored blob (`fileId`) are returned —
 * a folder input stages file bytes, so a text-only document has nothing to
 * stage. `name` is the title with the stored extension re-attached when the
 * title lacks it, so staged workspace files keep a usable suffix. Returns null
 * when the folder does not resolve within `organizationId` (callers surface
 * that as a legible failure instead of a silently empty directory).
 */
export async function listFilesByFolder(
  ctx: QueryCtx,
  args: {
    organizationId: string;
    folderId?: Id<'folders'>;
    folderPath?: string;
  },
): Promise<FolderFile[] | null> {
  let folderId: Id<'folders'> | null = args.folderId ?? null;
  if (!folderId && args.folderPath !== undefined) {
    folderId = await findFolderByPath(
      ctx,
      args.organizationId,
      args.folderPath.split('/'),
    );
  }
  if (!folderId) return null;
  // Freeze the narrowing for the index callback below (closures over a
  // mutable `let` lose it).
  const resolvedFolderId = folderId;
  // Coherence for the id path: a folder from another org resolves to null.
  const folder = await ctx.db.get(resolvedFolderId);
  if (!folder || folder.organizationId !== args.organizationId) return null;

  const files: FolderFile[] = [];
  const rows = ctx.db
    .query('documents')
    .withIndex('by_organizationId_and_folderId', (q) =>
      q
        .eq('organizationId', args.organizationId)
        .eq('folderId', resolvedFolderId),
    );
  for await (const doc of rows as AsyncIterable<Doc<'documents'>>) {
    if (!isActiveDocument(doc) || !doc.fileId) continue;
    const title = doc.title ?? doc.fileId;
    const ext = doc.extension;
    const name =
      ext && !title.toLowerCase().endsWith(`.${ext.toLowerCase()}`)
        ? `${title}.${ext}`
        : title;
    files.push({ fileId: doc.fileId, name });
  }
  return files;
}
