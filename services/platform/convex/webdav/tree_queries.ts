import { v } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { internalQuery } from '../_generated/server';
import { findFolderByPath } from '../folders/find_folder_by_path';

// Cap children returned for a single PROPFIND. RFC 4918 doesn't paginate
// — clients expect one 207 multistatus per request — so we truncate to
// keep individual responses bounded. The lib layer surfaces a
// `truncated` flag that the handler turns into a `Tale-Truncated: 1`
// response header and a warning log. Followup ticket: NextCloud-style
// `X-NC-Paginate` cursor for clients that need full enumeration.
export const MAX_CHILDREN_PER_PROPFIND = 1000;

// Path segments → either a folder id, a document id, or "not found".
// "root" is represented as folderId = null. Used by every method handler
// (PROPFIND/GET/PUT/DELETE/...) to map a WebDAV URL to backing rows.
//
// Folder-kind responses include `creationTime` so PROPFIND can emit
// `creationdate` / `getlastmodified` for the collection self-entry from
// real backing data instead of `new Date()`. Root has no backing row, so
// `creationTime` is null there.
export const resolvePath = internalQuery({
  args: {
    organizationId: v.string(),
    namespace: v.union(v.literal('documents'), v.literal('.trash')),
    segments: v.array(v.string()),
  },
  async handler(ctx, args) {
    if (args.segments.length === 0) {
      return { kind: 'root' as const, exists: true, creationTime: null };
    }
    return await resolvePathInner(
      ctx,
      args.organizationId,
      args.namespace,
      args.segments,
    );
  },
});

// Listing for a collection at the given folder. `folderId: null` means the
// org root. Returns child folders + child documents in one shot.
// Trash namespace returns trashed documents under the root only (no
// folder structure for trash in v1).
export const listCollection = internalQuery({
  args: {
    organizationId: v.string(),
    namespace: v.union(v.literal('documents'), v.literal('.trash')),
    folderId: v.union(v.id('folders'), v.null()),
  },
  async handler(ctx, args) {
    if (args.namespace === '.trash') {
      // Flat trash listing.
      const docs = await ctx.db
        .query('documents')
        .withIndex('by_organizationId_and_lifecycleStatus', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('lifecycleStatus', 'trashed'),
        )
        .collect();
      const sorted = docs.sort((a, b) => a._creationTime - b._creationTime);
      const truncated = sorted.length > MAX_CHILDREN_PER_PROPFIND;
      const slice = truncated
        ? sorted.slice(0, MAX_CHILDREN_PER_PROPFIND)
        : sorted;
      return {
        folders: [],
        documents: slice.map(documentRowToMeta),
        truncated,
      };
    }

    const parentId = args.folderId ?? undefined;
    const folders = await ctx.db
      .query('folders')
      .withIndex('by_org_parent_name', (q) =>
        q.eq('organizationId', args.organizationId).eq('parentId', parentId),
      )
      .collect();

    const rawDocs = await ctx.db
      .query('documents')
      .withIndex('by_organizationId_and_folderId', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('folderId', args.folderId ?? undefined),
      )
      .collect();
    const docs = rawDocs.filter(
      (d) => (d.lifecycleStatus ?? 'active') === 'active',
    );

    // Sort folders + documents independently by _creationTime asc, then
    // cap the COMBINED count at MAX_CHILDREN_PER_PROPFIND. Folders win
    // ties since collections are usually fewer and clients lean on them
    // for tree expansion; truncating leaf docs is the safer failure
    // mode than hiding subfolders.
    const sortedFolders = folders.sort(
      (a, b) => a._creationTime - b._creationTime,
    );
    const sortedDocs = docs.sort((a, b) => a._creationTime - b._creationTime);

    const total = sortedFolders.length + sortedDocs.length;
    const truncated = total > MAX_CHILDREN_PER_PROPFIND;

    let folderSlice = sortedFolders;
    let docSlice = sortedDocs;
    if (truncated) {
      if (sortedFolders.length >= MAX_CHILDREN_PER_PROPFIND) {
        folderSlice = sortedFolders.slice(0, MAX_CHILDREN_PER_PROPFIND);
        docSlice = [];
      } else {
        folderSlice = sortedFolders;
        docSlice = sortedDocs.slice(
          0,
          MAX_CHILDREN_PER_PROPFIND - sortedFolders.length,
        );
      }
    }

    return {
      folders: folderSlice.map((f) => ({
        _id: f._id,
        name: f.name,
        creationTime: f._creationTime,
      })),
      documents: docSlice.map(documentRowToMeta),
      truncated,
    };
  },
});

// Document props for PROPFIND on a single resource (or after Depth=1
// child enumeration). Joins fileMetadata for size + contentType.
export const getDocumentProps = internalQuery({
  args: {
    organizationId: v.string(),
    documentId: v.id('documents'),
  },
  async handler(ctx, args) {
    const doc = await ctx.db.get(args.documentId);
    if (!doc || doc.organizationId !== args.organizationId) return null;
    return await joinDocumentMetadata(ctx, doc);
  },
});

// --- helpers ---

type DocumentMeta = ReturnType<typeof documentRowToMeta>;

function documentRowToMeta(doc: Doc<'documents'>) {
  return {
    _id: doc._id,
    title: doc.title ?? '(untitled)',
    mimeType: doc.mimeType,
    extension: doc.extension,
    fileId: doc.fileId,
    contentHash: doc.contentHash,
    creationTime: doc._creationTime,
    sourceModifiedAt: doc.sourceModifiedAt,
    folderId: doc.folderId,
    lifecycleStatus: doc.lifecycleStatus,
  };
}

async function joinDocumentMetadata(
  ctx: QueryCtx,
  doc: Doc<'documents'>,
): Promise<
  DocumentMeta & {
    size: number | null;
    contentType: string | null;
  }
> {
  let size: number | null = null;
  let contentType: string | null = doc.mimeType ?? null;
  const fileId = doc.fileId;
  if (fileId) {
    const fm = await ctx.db
      .query('fileMetadata')
      .withIndex('by_storageId', (q) => q.eq('storageId', fileId))
      .first();
    if (fm) {
      size = fm.size;
      contentType = fm.contentType;
    }
  }
  return { ...documentRowToMeta(doc), size, contentType };
}

async function resolvePathInner(
  ctx: QueryCtx,
  organizationId: string,
  namespace: 'documents' | '.trash',
  segments: string[],
): Promise<
  | { kind: 'root'; exists: true; creationTime: null }
  | {
      kind: 'folder';
      folderId: Id<'folders'>;
      exists: true;
      creationTime: number;
    }
  | { kind: 'document'; documentId: Id<'documents'>; exists: true }
  | { kind: 'not_found'; exists: false }
> {
  // Trash namespace is flat in v1 — only direct children of root are
  // visible. A multi-segment path under .trash never resolves.
  if (namespace === '.trash') {
    if (segments.length !== 1) return { kind: 'not_found', exists: false };
    const all = await ctx.db
      .query('documents')
      .withIndex('by_organizationId_and_lifecycleStatus', (q) =>
        q.eq('organizationId', organizationId).eq('lifecycleStatus', 'trashed'),
      )
      .collect();
    const match = all.find((d) => (d.title ?? '') === segments[0]);
    if (match) {
      return { kind: 'document', documentId: match._id, exists: true };
    }
    return { kind: 'not_found', exists: false };
  }

  // documents namespace — walk segments via folders/find_folder_by_path
  // for the parent prefix, then check the final segment as either a
  // folder name (collection) or document title (resource).
  if (segments.length === 1) {
    const onlyName = segments[0];
    const folder = await ctx.db
      .query('folders')
      .withIndex('by_org_parent_name', (q) =>
        q
          .eq('organizationId', organizationId)
          .eq('parentId', undefined)
          .eq('name', onlyName),
      )
      .first();
    if (folder) {
      return {
        kind: 'folder',
        folderId: folder._id,
        exists: true,
        creationTime: folder._creationTime,
      };
    }
    const doc = await ctx.db
      .query('documents')
      .withIndex('by_organizationId_and_folderId', (q) =>
        q.eq('organizationId', organizationId).eq('folderId', undefined),
      )
      .collect();
    const match = doc.find(
      (d) =>
        (d.title ?? '') === onlyName &&
        (d.lifecycleStatus ?? 'active') === 'active',
    );
    if (match) return { kind: 'document', documentId: match._id, exists: true };
    return { kind: 'not_found', exists: false };
  }

  const parentSegments = segments.slice(0, -1);
  const leafName = segments[segments.length - 1];
  const parentFolderId = await findFolderByPath(
    ctx,
    organizationId,
    parentSegments,
  );
  if (!parentFolderId) return { kind: 'not_found', exists: false };

  // Try child folder first
  const childFolder = await ctx.db
    .query('folders')
    .withIndex('by_org_parent_name', (q) =>
      q
        .eq('organizationId', organizationId)
        .eq('parentId', parentFolderId)
        .eq('name', leafName),
    )
    .first();
  if (childFolder) {
    return {
      kind: 'folder',
      folderId: childFolder._id,
      exists: true,
      creationTime: childFolder._creationTime,
    };
  }

  // Then child document
  const childDocs = await ctx.db
    .query('documents')
    .withIndex('by_organizationId_and_folderId', (q) =>
      q.eq('organizationId', organizationId).eq('folderId', parentFolderId),
    )
    .collect();
  const matchDoc = childDocs.find(
    (d) =>
      (d.title ?? '') === leafName &&
      (d.lifecycleStatus ?? 'active') === 'active',
  );
  if (matchDoc) {
    return { kind: 'document', documentId: matchDoc._id, exists: true };
  }
  return { kind: 'not_found', exists: false };
}
