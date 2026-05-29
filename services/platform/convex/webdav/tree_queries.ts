import { v } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { internalQuery } from '../_generated/server';
import { findFolderByPath } from '../folders/find_folder_by_path';

// Path segments → either a folder id, a document id, or "not found".
// "root" is represented as folderId = null. Used by every method handler
// (PROPFIND/GET/PUT/DELETE/...) to map a WebDAV URL to backing rows.
export const resolvePath = internalQuery({
  args: {
    organizationId: v.string(),
    namespace: v.union(v.literal('documents'), v.literal('.trash')),
    segments: v.array(v.string()),
  },
  async handler(ctx, args) {
    if (args.segments.length === 0) {
      return { kind: 'root' as const, exists: true };
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
      return { folders: [], documents: docs.map(documentRowToMeta) };
    }

    const parentId = args.folderId ?? undefined;
    const folders = await ctx.db
      .query('folders')
      .withIndex('by_org_parent_name', (q) =>
        q.eq('organizationId', args.organizationId).eq('parentId', parentId),
      )
      .collect();

    const docs = await ctx.db
      .query('documents')
      .withIndex('by_organizationId_and_folderId', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('folderId', args.folderId ?? undefined),
      )
      .collect();

    return {
      folders: folders.map((f) => ({
        _id: f._id,
        name: f.name,
        creationTime: f._creationTime,
      })),
      documents: docs
        .filter((d) => (d.lifecycleStatus ?? 'active') === 'active')
        .map(documentRowToMeta),
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
  | { kind: 'root'; exists: true }
  | { kind: 'folder'; folderId: Id<'folders'>; exists: true }
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
    if (folder) return { kind: 'folder', folderId: folder._id, exists: true };
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
    return { kind: 'folder', folderId: childFolder._id, exists: true };
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
