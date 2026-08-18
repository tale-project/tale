import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { findFolderByPath } from '../folders/find_folder_by_path';
import type { BlobRef } from '../lib/storage/blob_ref';
import { isActiveDocument } from './_helpers';

export interface FolderFile {
  fileId: BlobRef;
  name: string;
}

// Recursion guards: a client's delivery tree is a handful of levels with at
// most a few hundred documents — these bounds exist so a pathological or
// cyclic tree can never wedge a query, and hitting them is loud (console) so
// truncation is never mistaken for "listed everything".
const MAX_RECURSION_DEPTH = 8;
const MAX_RECURSIVE_FILES = 500;

/**
 * Files inside one folder, addressed by id or by its human-readable documents
 * path ("Clients/Acme GmbH"). By default only DIRECT children are listed;
 * `recursive: true` walks the subfolder tree breadth-first and prefixes each
 * file's `name` with its subfolder path ("Documentation/Invoice 123.pdf") —
 * consumers that write files (sandbox staging) create the subdirectories from
 * that relative path, so a client's delivered folder structure survives
 * end-to-end. Powers the sandbox folder-input staging: only rows with a
 * stored blob (`fileId`) are returned — a folder input stages file bytes, so
 * a text-only document has nothing to stage. `name` is the title with the
 * stored extension re-attached when the title lacks it, so staged workspace
 * files keep a usable suffix. Returns null when the folder does not resolve
 * within `organizationId` (callers surface that as a legible failure instead
 * of a silently empty directory).
 */
export async function listFilesByFolder(
  ctx: QueryCtx,
  args: {
    organizationId: string;
    folderId?: Id<'folders'>;
    folderPath?: string;
    recursive?: boolean;
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
  const queue: Array<{ id: Id<'folders'>; prefix: string; depth: number }> = [
    { id: resolvedFolderId, prefix: '', depth: 0 },
  ];
  while (queue.length > 0) {
    // Bounded queue — shift() is fine at this scale.
    const current = queue.shift();
    if (current === undefined) break;
    const rows = ctx.db
      .query('documents')
      .withIndex('by_organizationId_and_folderId', (q) =>
        q.eq('organizationId', args.organizationId).eq('folderId', current.id),
      );
    for await (const doc of rows as AsyncIterable<Doc<'documents'>>) {
      if (!isActiveDocument(doc) || !doc.fileId) continue;
      if (files.length >= MAX_RECURSIVE_FILES) {
        console.warn(
          `[listFilesByFolder] truncated at ${MAX_RECURSIVE_FILES} files under folder ${resolvedFolderId} — the listing is INCOMPLETE`,
        );
        return files;
      }
      const title = doc.title ?? doc.fileId;
      const ext = doc.extension;
      const name =
        ext && !title.toLowerCase().endsWith(`.${ext.toLowerCase()}`)
          ? `${title}.${ext}`
          : title;
      files.push({ fileId: doc.fileId, name: `${current.prefix}${name}` });
    }
    if (!args.recursive) break;
    if (current.depth >= MAX_RECURSION_DEPTH) {
      console.warn(
        `[listFilesByFolder] depth cap ${MAX_RECURSION_DEPTH} reached under folder ${resolvedFolderId} — deeper subfolders were NOT listed`,
      );
      continue;
    }
    // Subfolders share the parent's scope: the (org, projectId, parentId)
    // index prefix enumerates exactly this folder's children.
    const children = await ctx.db
      .query('folders')
      .withIndex('by_org_project_parent_name', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('projectId', folder.projectId)
          .eq('parentId', current.id),
      )
      .collect();
    for (const child of children) {
      queue.push({
        id: child._id,
        prefix: `${current.prefix}${child.name}/`,
        depth: current.depth + 1,
      });
    }
  }
  return files;
}
