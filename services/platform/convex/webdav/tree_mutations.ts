import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { internalMutation } from '../_generated/server';
import { createDocument } from '../documents/create_document';
import { extractExtension } from '../documents/extract_extension';
import { findFolderByPath } from '../folders/find_folder_by_path';
import { getOrCreateFolderPath } from '../folders/get_or_create_path';

const WEBDAV_SOURCE_PROVIDER = 'webdav';

// Internal generate-upload-url for the WebDAV PUT path. Mirrors
// files/mutations.generateUploadUrl but bypasses Better Auth — Hono
// has already done its own Basic-auth check.
export const generateWebdavUploadUrl = internalMutation({
  args: {},
  async handler(ctx) {
    return await ctx.storage.generateUploadUrl();
  },
});

// PUT entry point. Hono has already written the blob to _storage and
// holds the storageId; this mutation either creates or replaces the
// document row. Returns { created: true } / { created: false } so the
// caller can pick 201 vs 204.
export const ingestPutBlob = internalMutation({
  args: {
    organizationId: v.string(),
    pathSegments: v.array(v.string()),
    storageId: v.id('_storage'),
    contentType: v.string(),
    size: v.number(),
    userId: v.string(),
  },
  async handler(ctx, args) {
    if (args.pathSegments.length === 0) {
      throw new ConvexError({ code: 'INVALID_PATH' });
    }
    const parentSegments = args.pathSegments.slice(0, -1);
    const fileName = args.pathSegments[args.pathSegments.length - 1];

    const folderId =
      parentSegments.length > 0
        ? await getOrCreateFolderPath(
            ctx,
            args.organizationId,
            parentSegments,
            args.userId,
          )
        : undefined;

    // Find existing doc by (folderId, title) — overwrite case
    const candidates = await ctx.db
      .query('documents')
      .withIndex('by_organizationId_and_folderId', (q) =>
        q.eq('organizationId', args.organizationId).eq('folderId', folderId),
      )
      .collect();
    const existing = candidates.find(
      (d) =>
        (d.title ?? '') === fileName &&
        (d.lifecycleStatus ?? 'active') === 'active',
    );

    // Always write fileMetadata first — saveFileMetadata schedules the
    // RAG upload as a side effect, so this single call handles both the
    // raw blob registration and indexing.
    await ctx.runMutation(
      internal.file_metadata.internal_mutations.saveFileMetadata,
      {
        organizationId: args.organizationId,
        storageId: args.storageId,
        fileName,
        contentType: args.contentType,
        size: args.size,
        uploadedBy: args.userId,
      },
    );

    if (existing) {
      await ctx.db.patch(existing._id, {
        fileId: args.storageId,
        mimeType: args.contentType,
        extension: extractExtension(fileName),
        sourceModifiedAt: Date.now(),
      });
      return { created: false, documentId: existing._id };
    }

    const result = await createDocument(ctx, {
      organizationId: args.organizationId,
      title: fileName,
      fileId: args.storageId,
      mimeType: args.contentType,
      extension: extractExtension(fileName),
      sourceProvider: WEBDAV_SOURCE_PROVIDER,
      sourceCreatedAt: Date.now(),
      sourceModifiedAt: Date.now(),
      createdBy: args.userId,
      folderId,
    });
    return { created: true, documentId: result.documentId };
  },
});

export const softDeleteDocument = internalMutation({
  args: {
    organizationId: v.string(),
    documentId: v.id('documents'),
  },
  async handler(ctx, args) {
    const doc = await ctx.db.get(args.documentId);
    if (!doc || doc.organizationId !== args.organizationId) {
      throw new ConvexError({ code: 'NOT_FOUND' });
    }
    if ((doc.lifecycleStatus ?? 'active') !== 'active') return;
    await ctx.db.patch(args.documentId, {
      lifecycleStatus: 'trashed',
      statusChangedAt: Date.now(),
    });
  },
});

// DELETE on a folder cascades to all descendant documents (soft) and
// folders (hard — folder rows hold no blobs, no purge needed).
export const deleteFolderCascade = internalMutation({
  args: {
    organizationId: v.string(),
    folderId: v.id('folders'),
  },
  async handler(ctx, args) {
    await cascadeDeleteFolderRecursive(ctx, args.organizationId, args.folderId);
  },
});

export const mkcol = internalMutation({
  args: {
    organizationId: v.string(),
    parentSegments: v.array(v.string()),
    name: v.string(),
    userId: v.string(),
  },
  async handler(ctx, args) {
    // RFC 4918 §9.3.1: parent must already exist (when there are parents).
    let parentId: Id<'folders'> | undefined = undefined;
    if (args.parentSegments.length > 0) {
      const found = await findFolderByPath(
        ctx,
        args.organizationId,
        args.parentSegments,
      );
      if (!found) throw new ConvexError({ code: 'CONFLICT' });
      parentId = found;
    }

    // RFC 4918 §9.3.1: 405 if the resource already exists.
    const existing = await ctx.db
      .query('folders')
      .withIndex('by_org_parent_name', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('parentId', parentId)
          .eq('name', args.name),
      )
      .first();
    if (existing) throw new ConvexError({ code: 'METHOD_NOT_ALLOWED' });

    const id = await ctx.db.insert('folders', {
      organizationId: args.organizationId,
      name: args.name,
      parentId,
      createdBy: args.userId,
    });
    return { folderId: id };
  },
});

// MOVE: rename / move a document. Folder moves are folder-id-tree
// rewrites (no descendant scan needed since folderId is the canonical
// link). Returns { created: true } if the destination was new.
export const moveResource = internalMutation({
  args: {
    organizationId: v.string(),
    src: v.union(
      v.object({ kind: v.literal('document'), id: v.id('documents') }),
      v.object({ kind: v.literal('folder'), id: v.id('folders') }),
    ),
    destParentSegments: v.array(v.string()),
    destName: v.string(),
    overwrite: v.boolean(),
    userId: v.string(),
  },
  async handler(ctx, args) {
    const destFolderId =
      args.destParentSegments.length > 0
        ? await getOrCreateFolderPath(
            ctx,
            args.organizationId,
            args.destParentSegments,
            args.userId,
          )
        : undefined;

    const collision = await findCollision(
      ctx,
      args.organizationId,
      destFolderId ?? null,
      args.destName,
    );

    if (collision && !args.overwrite) {
      throw new ConvexError({ code: 'CONFLICT' });
    }
    if (collision && args.overwrite) {
      if (collision.kind === 'document') {
        await ctx.db.delete(collision.id);
      } else {
        await cascadeDeleteFolderRecursive(
          ctx,
          args.organizationId,
          collision.id,
        );
      }
    }

    if (args.src.kind === 'document') {
      await ctx.db.patch(args.src.id, {
        title: args.destName,
        folderId: destFolderId,
        sourceModifiedAt: Date.now(),
      });
    } else {
      await ctx.db.patch(args.src.id, {
        name: args.destName,
        parentId: destFolderId,
      });
    }
    return { created: collision === null };
  },
});

export const copyResource = internalMutation({
  args: {
    organizationId: v.string(),
    src: v.union(
      v.object({ kind: v.literal('document'), id: v.id('documents') }),
      v.object({ kind: v.literal('folder'), id: v.id('folders') }),
    ),
    destParentSegments: v.array(v.string()),
    destName: v.string(),
    overwrite: v.boolean(),
    userId: v.string(),
  },
  async handler(ctx, args) {
    const destFolderId =
      args.destParentSegments.length > 0
        ? await getOrCreateFolderPath(
            ctx,
            args.organizationId,
            args.destParentSegments,
            args.userId,
          )
        : undefined;

    const collision = await findCollision(
      ctx,
      args.organizationId,
      destFolderId ?? null,
      args.destName,
    );

    if (collision && !args.overwrite) {
      throw new ConvexError({ code: 'CONFLICT' });
    }
    if (collision && args.overwrite) {
      if (collision.kind === 'document') {
        await ctx.db.delete(collision.id);
      } else {
        await cascadeDeleteFolderRecursive(
          ctx,
          args.organizationId,
          collision.id,
        );
      }
    }

    if (args.src.kind === 'document') {
      const src = await ctx.db.get(args.src.id);
      if (!src) throw new ConvexError({ code: 'NOT_FOUND' });
      // Same storageId — Convex _storage is content-hashed, so the
      // destination is just another reference to the same bytes.
      await createDocument(ctx, {
        organizationId: args.organizationId,
        title: args.destName,
        fileId: src.fileId,
        mimeType: src.mimeType,
        extension: src.extension,
        contentHash: src.contentHash,
        sourceProvider: WEBDAV_SOURCE_PROVIDER,
        sourceCreatedAt: Date.now(),
        sourceModifiedAt: Date.now(),
        createdBy: args.userId,
        folderId: destFolderId,
      });
      return { created: collision === null };
    }

    // Folder copy: recursive. RFC 4918 §9.8 allows COPY of a collection
    // to act on all descendants — we honour with a server-side recurse.
    await copyFolderRecursive(
      ctx,
      args.organizationId,
      args.src.id,
      destFolderId ?? null,
      args.destName,
      args.userId,
    );
    return { created: collision === null };
  },
});

// --- internal helpers ---

async function findCollision(
  ctx: MutationCtx,
  organizationId: string,
  parentFolderId: Id<'folders'> | null,
  name: string,
): Promise<
  | { kind: 'document'; id: Id<'documents'> }
  | { kind: 'folder'; id: Id<'folders'> }
  | null
> {
  const folder = await ctx.db
    .query('folders')
    .withIndex('by_org_parent_name', (q) =>
      q
        .eq('organizationId', organizationId)
        .eq('parentId', parentFolderId ?? undefined)
        .eq('name', name),
    )
    .first();
  if (folder) return { kind: 'folder', id: folder._id };

  const docs = await ctx.db
    .query('documents')
    .withIndex('by_organizationId_and_folderId', (q) =>
      q
        .eq('organizationId', organizationId)
        .eq('folderId', parentFolderId ?? undefined),
    )
    .collect();
  const doc = docs.find(
    (d) =>
      (d.title ?? '') === name && (d.lifecycleStatus ?? 'active') === 'active',
  );
  if (doc) return { kind: 'document', id: doc._id };
  return null;
}

async function cascadeDeleteFolderRecursive(
  ctx: MutationCtx,
  organizationId: string,
  folderId: Id<'folders'>,
): Promise<void> {
  const children = await ctx.db
    .query('folders')
    .withIndex('by_org_parent_name', (q) =>
      q.eq('organizationId', organizationId).eq('parentId', folderId),
    )
    .collect();
  for (const c of children) {
    await cascadeDeleteFolderRecursive(ctx, organizationId, c._id);
  }
  const docs = await ctx.db
    .query('documents')
    .withIndex('by_organizationId_and_folderId', (q) =>
      q.eq('organizationId', organizationId).eq('folderId', folderId),
    )
    .collect();
  for (const d of docs) {
    if ((d.lifecycleStatus ?? 'active') === 'active') {
      await ctx.db.patch(d._id, {
        lifecycleStatus: 'trashed',
        statusChangedAt: Date.now(),
      });
    }
  }
  await ctx.db.delete(folderId);
}

async function copyFolderRecursive(
  ctx: MutationCtx,
  organizationId: string,
  srcFolderId: Id<'folders'>,
  destParentId: Id<'folders'> | null,
  destName: string,
  userId: string,
): Promise<Id<'folders'>> {
  const newFolderId = await ctx.db.insert('folders', {
    organizationId,
    name: destName,
    parentId: destParentId ?? undefined,
    createdBy: userId,
  });

  const childFolders = await ctx.db
    .query('folders')
    .withIndex('by_org_parent_name', (q) =>
      q.eq('organizationId', organizationId).eq('parentId', srcFolderId),
    )
    .collect();
  for (const cf of childFolders) {
    await copyFolderRecursive(
      ctx,
      organizationId,
      cf._id,
      newFolderId,
      cf.name,
      userId,
    );
  }

  const childDocs = await ctx.db
    .query('documents')
    .withIndex('by_organizationId_and_folderId', (q) =>
      q.eq('organizationId', organizationId).eq('folderId', srcFolderId),
    )
    .collect();
  for (const d of childDocs) {
    if ((d.lifecycleStatus ?? 'active') !== 'active') continue;
    await createDocument(ctx, {
      organizationId,
      title: d.title ?? '(untitled)',
      fileId: d.fileId,
      mimeType: d.mimeType,
      extension: d.extension,
      contentHash: d.contentHash,
      sourceProvider: WEBDAV_SOURCE_PROVIDER,
      sourceCreatedAt: Date.now(),
      sourceModifiedAt: Date.now(),
      createdBy: userId,
      folderId: newFolderId,
    });
  }
  return newFolderId;
}

// Suppress no-unused warnings for the Doc type — used inline via ctx.db.get.
type _Doc = Doc<'documents'>;
