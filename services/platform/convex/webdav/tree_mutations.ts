import { ConvexError, v } from 'convex/values';

import { resolveFileType } from '../../lib/shared/file-types';
import { isTextBasedFile } from '../../lib/utils/text-file-types';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { internalMutation } from '../_generated/server';
import { isProjectScopedDocument } from '../documents/access';
import { createDocument } from '../documents/create_document';
import { extractExtension } from '../documents/extract_extension';
import { findFolderByPath } from '../folders/find_folder_by_path';
import { MAX_FOLDER_DEPTH } from '../folders/mutations';
import { buildFolderPath } from '../folders/queries';
import {
  blobRefValidator,
  convexStorageId,
  type BlobRef,
} from '../lib/storage/blob_ref';
import {
  budgetTake,
  chargeReadBudget,
  newReadBudget,
  type ReadBudget,
} from './bulk_budget';
import {
  assertWebdavDocNotHeld,
  assertWebdavFolderTreeNotHeld,
} from './hold_guard';
import { isWebdavVisibleDocument, isWebdavVisibleFolder } from './visibility';

const WEBDAV_SOURCE_PROVIDER = 'webdav';

// Source-provider slugs whose docs are part of an external sync loop.
// When a MOVE detaches the doc from its sync root we clear these so the
// connector doesn't see the row as still belonging to its tree.
const SYNC_SOURCE_PROVIDERS = new Set([
  'onedrive',
  'sharepoint',
  'google_drive',
  'gdrive',
  'google-drive',
]);

// NFC normalisation belt-and-suspenders. paths.ts already normalises at
// the wire boundary; this second pass protects against callers that hit
// the mutations directly (e.g. tests, scripts) and would otherwise leave
// mixed NFD rows in storage.
function nfc(s: string): string {
  return s.normalize('NFC');
}

// Internal generate-upload-url for the WebDAV PUT path. Mirrors
// files/mutations.generateUploadUrl but bypasses Better Auth — Hono
// has already done its own Basic-auth check. Used only for the
// unknown-Content-Length fallback (a chunked PUT can't target an S3
// presigned PUT); the sized path routes through the backend-aware
// files.blob_actions.generateWebdavBlobUpload so BYO-bucket orgs land
// WebDAV files in their own bucket.
export const generateWebdavUploadUrl = internalMutation({
  args: {},
  async handler(ctx) {
    return await ctx.storage.generateUploadUrl();
  },
});

// Reclaim an uploaded blob whose ingest failed. PUT streams the body to
// _storage BEFORE ingestPutBlob runs its preconditions (missing parent →
// 409, invalid path → 400). ingestPutBlob is transactional, so on a throw
// no documents/fileMetadata row references the blob — and the retention
// sweep only enumerates fileMetadata rows, so the blob would leak forever.
// The PUT handler calls this from its ingest catch. Idempotent.
export const deleteWebdavBlob = internalMutation({
  args: {
    storageId: blobRefValidator,
    // Required to reclaim an `s3:` blob (a mutation can't sign an S3 delete, so
    // it schedules the org-scoped node action). Omit only for Convex refs.
    organizationId: v.optional(v.string()),
  },
  async handler(ctx, args) {
    const convexId = convexStorageId(args.storageId);
    if (convexId !== null) {
      try {
        await ctx.storage.delete(convexId);
      } catch (err) {
        console.warn('[webdav] deleteWebdavBlob failed', err);
      }
      return;
    }
    if (args.organizationId === undefined) {
      console.warn(
        '[webdav] deleteWebdavBlob: s3 ref without organizationId; cannot reclaim',
        args.storageId,
      );
      return;
    }
    await ctx.scheduler.runAfter(
      0,
      internal.files.blob_actions.deleteOrgBlobs,
      { organizationId: args.organizationId, refs: [String(args.storageId)] },
    );
  },
});

// PUT entry point. Hono has already written the blob to the org's store
// (Convex `_storage` or the org's own S3 bucket) and holds the reference;
// this mutation either creates or replaces the document row. Returns
// { created: true } / { created: false } so the caller can pick 201 vs 204.
export const ingestPutBlob = internalMutation({
  args: {
    organizationId: v.string(),
    pathSegments: v.array(v.string()),
    // A Convex `_storage` id OR an `s3:` ref when the org has its own bucket.
    storageId: blobRefValidator,
    contentType: v.string(),
    size: v.number(),
    userId: v.string(),
    // X-OC-Mtime (unix seconds, OwnCloud/NextCloud convention) lets
    // sync clients preserve mtime through round-trips. Mapped to ms by
    // the caller. Absent → wall clock.
    sourceModifiedAtMs: v.optional(v.number()),
  },
  async handler(ctx, args) {
    if (args.pathSegments.length === 0) {
      throw new ConvexError({ code: 'INVALID_PATH' });
    }
    const parentSegments = args.pathSegments.slice(0, -1).map(nfc);
    const fileName = nfc(args.pathSegments[args.pathSegments.length - 1]);

    // WebDAV clients (GVfs/davfs2) routinely PUT with a generic
    // `application/octet-stream` Content-Type, which would otherwise be
    // stored verbatim and make remote file managers show blank/unknown
    // icons (DAV:getcontenttype is derived from this). Derive the real MIME
    // from the filename extension exactly as the web upload path does
    // (documents/mutations.createDocumentFromUpload) so both ingestion
    // routes converge on the same canonical type.
    let resolvedContentType = resolveFileType(fileName, args.contentType);
    // resolveFileType only maps the binary document/image formats; text
    // files (markdown, source, config, logs) fall through to whatever
    // generic type the client sent. Classify those by name and label them
    // text/plain so they get a real text icon too. Scoped to WebDAV ingest
    // on purpose: the web Documents upload allowlist accepts only .txt among
    // text files, so widening the shared resolveFileType would also widen
    // that allowlist.
    if (
      (resolvedContentType === 'application/octet-stream' ||
        resolvedContentType === '') &&
      isTextBasedFile(fileName)
    ) {
      resolvedContentType = 'text/plain';
    }

    // RFC 4918 §9.7.1: a PUT may not auto-vivify intermediate
    // collections. If any ancestor is missing the request 409s.
    let folderId: Id<'folders'> | undefined = undefined;
    if (parentSegments.length > 0) {
      const found = await findFolderByPath(
        ctx,
        args.organizationId,
        parentSegments,
      );
      if (!found) {
        throw new ConvexError({ code: 'CONFLICT' });
      }
      folderId = found;
    }

    // Find the existing doc to overwrite by exact (org, title, folder). The
    // composite index bounds the scan to same-name docs in THIS folder
    // (0-1 active in practice) instead of every same-name doc in the org —
    // a name repeated across a synced tree would otherwise collect O(all).
    // Project-scoped docs are invisible to WebDAV (#2545): a PUT whose name
    // collides with one must create an independent hub document, never bind
    // to (and replace the blob of) the project row.
    const titleMatches = await ctx.db
      .query('documents')
      .withIndex('by_org_title_folder', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('title', fileName)
          .eq('folderId', folderId),
      )
      .collect();
    const existing = titleMatches.find((d) => isWebdavVisibleDocument(d));

    // Legal-hold gate on overwrite: a held document must not be content-
    // replaced. Assert BEFORE saveFileMetadata so a held overwrite never
    // registers metadata or schedules a RAG re-index. On throw the PUT handler
    // reclaims the already-uploaded orphan blob (deleteWebdavBlob).
    if (existing) {
      await assertWebdavDocNotHeld(ctx, args.organizationId, existing);
    }

    // Always write fileMetadata first — saveFileMetadata schedules the
    // RAG upload as a side effect, so this single call handles both the
    // raw blob registration and indexing.
    await ctx.runMutation(
      internal.file_metadata.internal_mutations.saveFileMetadata,
      {
        organizationId: args.organizationId,
        storageId: args.storageId,
        fileName,
        contentType: resolvedContentType,
        size: args.size,
        uploadedBy: args.userId,
      },
    );

    // Pull the sha256 Convex computes on upload — fileMetadata stores
    // it but documents.contentHash is the field most reads go through.
    // Only Convex `_storage` blobs get an automatic hash; an S3-backed
    // upload has none here, so contentHash stays undefined (change
    // detection falls back to size/mtime for those rows).
    const convexBlobId = convexStorageId(args.storageId);
    const sha256 =
      convexBlobId !== null
        ? await ctx.runQuery(
            internal.file_metadata.internal_queries.getStorageSha256,
            { storageId: convexBlobId },
          )
        : null;

    const sourceModifiedAt = args.sourceModifiedAtMs ?? Date.now();

    if (existing) {
      const oldFileId = existing.fileId;
      await ctx.db.patch(existing._id, {
        fileId: args.storageId,
        mimeType: resolvedContentType,
        extension: extractExtension(fileName),
        contentHash: sha256 ?? undefined,
        sourceModifiedAt,
      });
      await ctx.runMutation(
        internal.file_metadata.internal_mutations.linkDocumentToFile,
        { storageId: args.storageId, documentId: existing._id },
      );
      // Purge the prior blob + mark the old fileMetadata row trashed.
      // Done inline because we have no eraseStorageBlob action; the
      // operations are O(1) so they don't blow the mutation budget.
      if (oldFileId && oldFileId !== args.storageId) {
        await purgeOldBlob(ctx, args.organizationId, oldFileId);
      }
      return { created: false, documentId: existing._id };
    }

    const result = await createDocument(ctx, {
      organizationId: args.organizationId,
      title: fileName,
      fileId: args.storageId,
      mimeType: resolvedContentType,
      extension: extractExtension(fileName),
      contentHash: sha256 ?? undefined,
      sourceProvider: WEBDAV_SOURCE_PROVIDER,
      sourceCreatedAt: Date.now(),
      sourceModifiedAt,
      createdBy: args.userId,
      folderId,
    });
    await ctx.runMutation(
      internal.file_metadata.internal_mutations.linkDocumentToFile,
      { storageId: args.storageId, documentId: result.documentId },
    );
    return { created: true, documentId: result.documentId };
  },
});

export const softDeleteDocument = internalMutation({
  args: {
    organizationId: v.string(),
    documentId: v.id('documents'),
  },
  async handler(ctx, args) {
    await softDeleteDocumentInner(ctx, args.organizationId, args.documentId);
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
    await assertVisibleFolderSrc(ctx, args.organizationId, args.folderId);
    await cascadeDeleteFolderRecursive(ctx, args.organizationId, args.folderId);
  },
});

/**
 * Id-level gate for mutations handed a raw folder id: WebDAV path
 * resolution can never yield a project folder, so a project (or foreign-org
 * or missing) folder id here reads as not-found — the folder twin of the
 * `isWebdavVisibleDocument` guards on the document branches.
 */
async function assertVisibleFolderSrc(
  ctx: MutationCtx,
  organizationId: string,
  folderId: Id<'folders'>,
): Promise<void> {
  const folder = await ctx.db.get(folderId);
  if (
    !folder ||
    folder.organizationId !== organizationId ||
    !isWebdavVisibleFolder(folder)
  ) {
    throw new ConvexError({ code: 'NOT_FOUND' });
  }
}

export const mkcol = internalMutation({
  args: {
    organizationId: v.string(),
    parentSegments: v.array(v.string()),
    name: v.string(),
    userId: v.string(),
  },
  async handler(ctx, args) {
    const name = nfc(args.name);
    const parentSegments = args.parentSegments.map(nfc);

    // Depth cap, mirroring createFolder (folders/mutations.ts). The new folder
    // would nest at parentSegments.length + 1. Reject past MAX_FOLDER_DEPTH so
    // folders never nest deeper than the recursive delete/copy/cycle-check
    // helpers can traverse — otherwise such folders become un-deletable,
    // un-movable, and un-copyable (every attempt 409s).
    if (parentSegments.length + 1 > MAX_FOLDER_DEPTH) {
      throw new ConvexError({ code: 'CONFLICT' });
    }

    // RFC 4918 §9.3.1: parent must already exist (when there are parents).
    let parentId: Id<'folders'> | undefined = undefined;
    if (parentSegments.length > 0) {
      const found = await findFolderByPath(
        ctx,
        args.organizationId,
        parentSegments,
      );
      if (!found) throw new ConvexError({ code: 'CONFLICT' });
      parentId = found;
    }

    // RFC 4918 §9.3.1: 405 if a resource already exists at the Request-URI.
    // findCollision checks BOTH folders and documents — a folders-only check
    // would let MKCOL silently shadow an existing document of the same name,
    // making that document permanently unreachable via GET/PUT/DELETE/MOVE.
    const existing = await findCollision(
      ctx,
      args.organizationId,
      parentId ?? null,
      name,
    );
    if (existing) throw new ConvexError({ code: 'METHOD_NOT_ALLOWED' });

    const id = await ctx.db.insert('folders', {
      organizationId: args.organizationId,
      name,
      parentId,
      createdBy: args.userId,
    });
    return { folderId: id };
  },
});

// MOVE: rename / move a document or folder. Returns { created: true }
// if the destination was new. Lock rows at the source are deleted —
// RFC §7.5 says locks don't migrate with the resource.
export const moveResource = internalMutation({
  args: {
    organizationId: v.string(),
    src: v.union(
      v.object({ kind: v.literal('document'), id: v.id('documents') }),
      v.object({ kind: v.literal('folder'), id: v.id('folders') }),
    ),
    // Original src path, used to clean up webdavLocks rows that don't
    // travel with the resource (RFC §7.5).
    srcSegments: v.array(v.string()),
    destParentSegments: v.array(v.string()),
    destName: v.string(),
    overwrite: v.boolean(),
    userId: v.string(),
  },
  async handler(ctx, args) {
    const destName = nfc(args.destName);
    const destParentSegments = args.destParentSegments.map(nfc);
    const srcSegments = args.srcSegments.map(nfc);

    if (args.src.kind === 'folder') {
      await assertVisibleFolderSrc(ctx, args.organizationId, args.src.id);
    }

    // RFC 4918 §9.8.5 / §9.9.4: destination parent must exist; the
    // server does not auto-vivify intermediate collections.
    let destFolderId: Id<'folders'> | undefined = undefined;
    if (destParentSegments.length > 0) {
      const found = await findFolderByPath(
        ctx,
        args.organizationId,
        destParentSegments,
      );
      if (!found) throw new ConvexError({ code: 'DEST_PARENT_MISSING' });
      destFolderId = found;
    }

    // Self-move guard. For documents, "self" means same folder + same
    // name. For folders, same parent + same name.
    const collision = await findCollision(
      ctx,
      args.organizationId,
      destFolderId ?? null,
      destName,
    );
    if (
      collision !== null &&
      collision.kind === args.src.kind &&
      collision.id === args.src.id
    ) {
      throw new ConvexError({ code: 'SELF_DESTINATION' });
    }

    // Folder-into-own-descendant guard. Walk parentId up from the
    // destination; if we cross src.id we'd build a cycle.
    if (args.src.kind === 'folder' && destFolderId) {
      await assertNotDescendantOf(ctx, destFolderId, args.src.id);
    }

    if (collision && !args.overwrite) {
      throw new ConvexError({ code: 'DEST_EXISTS' });
    }
    if (collision && args.overwrite) {
      // Route through softDeleteDocument / cascadeDeleteFolderRecursive
      // so blob + fileMetadata + lock rows are cleaned, not just the
      // documents row.
      if (collision.kind === 'document') {
        await softDeleteDocumentInner(ctx, args.organizationId, collision.id);
      } else {
        await cascadeDeleteFolderRecursive(
          ctx,
          args.organizationId,
          collision.id,
        );
      }
    }

    if (args.src.kind === 'document') {
      const existing = await ctx.db.get(args.src.id);
      // Project-scoped docs are not WebDAV resources (#2545).
      if (!existing || isProjectScopedDocument(existing)) {
        throw new ConvexError({ code: 'NOT_FOUND' });
      }
      const newFolderPath = destFolderId
        ? await buildFolderPath(ctx, destFolderId)
        : undefined;
      const patch: Record<string, unknown> = {
        title: destName,
        folderId: destFolderId,
        folderPath: newFolderPath,
        sourceModifiedAt: Date.now(),
      };
      // Connector-sourced docs lose their external binding on move —
      // we don't try to figure out whether the new folder sits inside
      // the sync root; safest is to detach. The connector will re-create
      // the row at the new path on the next sweep if applicable.
      if (
        existing.sourceProvider &&
        SYNC_SOURCE_PROVIDERS.has(existing.sourceProvider)
      ) {
        patch.sourceProvider = undefined;
        patch.externalItemId = undefined;
        patch.driveId = undefined;
      }
      await ctx.db.patch(args.src.id, patch);
      // Keep RAG's denormalized folder_path fresh so the folder-scoped
      // search filter follows the move. Best-effort (the action
      // warn-and-skips on failure); RAG updates zero rows for files
      // that were never indexed.
      if (existing.fileId) {
        await ctx.scheduler.runAfter(
          0,
          internal.documents.internal_actions.syncRagFolderPaths,
          {
            organizationId: args.organizationId,
            updates: [{ fileId: existing.fileId, folderPath: newFolderPath }],
          },
        );
      }
    } else {
      await ctx.db.patch(args.src.id, {
        name: destName,
        parentId: destFolderId,
      });
      // Reparenting/renaming a folder changes the ABSOLUTE path of every
      // descendant document, so their denormalized folderPath is now stale and
      // (for connector-sourced docs) their external bindings point at a tree
      // they've left. Recompute folderPath and detach synced docs for the whole
      // subtree, mirroring the per-document branch above — otherwise the
      // external-sync reconcile (which matches on folderPath / folderPathPrefix)
      // mis-matches the relocated subtree and re-creates duplicates.
      const ragFolderPathUpdates: Array<{
        fileId: BlobRef;
        folderPath?: string;
      }> = [];
      await fixupMovedFolderDescendants(
        ctx,
        args.organizationId,
        args.src.id,
        0,
        newReadBudget(),
        ragFolderPathUpdates,
      );
      // One batch for the whole subtree; the action chunks the PATCH
      // calls to the RAG endpoint's batch limit.
      if (ragFolderPathUpdates.length > 0) {
        await ctx.scheduler.runAfter(
          0,
          internal.documents.internal_actions.syncRagFolderPaths,
          {
            organizationId: args.organizationId,
            updates: ragFolderPathUpdates,
          },
        );
      }
    }

    // Drop lock rows at the old path (and below for folder moves).
    await purgeLocksAtAndBelow(
      ctx,
      args.organizationId,
      lockKeyForSegments(srcSegments),
      args.src.kind === 'folder',
    );

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
    const destName = nfc(args.destName);
    const destParentSegments = args.destParentSegments.map(nfc);

    if (args.src.kind === 'folder') {
      await assertVisibleFolderSrc(ctx, args.organizationId, args.src.id);
    }

    let destFolderId: Id<'folders'> | undefined = undefined;
    if (destParentSegments.length > 0) {
      const found = await findFolderByPath(
        ctx,
        args.organizationId,
        destParentSegments,
      );
      if (!found) throw new ConvexError({ code: 'DEST_PARENT_MISSING' });
      destFolderId = found;
    }

    const collision = await findCollision(
      ctx,
      args.organizationId,
      destFolderId ?? null,
      destName,
    );

    // Self-copy guard mirrors moveResource — copying a folder onto
    // itself or a doc onto itself would just duplicate/overwrite.
    if (
      collision !== null &&
      collision.kind === args.src.kind &&
      collision.id === args.src.id
    ) {
      throw new ConvexError({ code: 'SELF_DESTINATION' });
    }
    if (args.src.kind === 'folder' && destFolderId) {
      await assertNotDescendantOf(ctx, destFolderId, args.src.id);
    }

    if (collision && !args.overwrite) {
      throw new ConvexError({ code: 'DEST_EXISTS' });
    }
    if (collision && args.overwrite) {
      if (collision.kind === 'document') {
        await softDeleteDocumentInner(ctx, args.organizationId, collision.id);
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
      // Project-scoped docs are not WebDAV resources (#2545).
      if (!src || isProjectScopedDocument(src)) {
        throw new ConvexError({ code: 'NOT_FOUND' });
      }
      // Same storageId — Convex _storage is content-hashed, so the
      // destination is just another reference to the same bytes.
      await createDocument(ctx, {
        organizationId: args.organizationId,
        title: destName,
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
      destName,
      args.userId,
      0,
    );
    return { created: collision === null };
  },
});

// --- internal helpers ---

async function softDeleteDocumentInner(
  ctx: MutationCtx,
  organizationId: string,
  documentId: Id<'documents'>,
): Promise<void> {
  const doc = await ctx.db.get(documentId);
  // A project-scoped doc is not a WebDAV resource (#2545) — behave exactly
  // as if the path never resolved, mirroring the REST 404s.
  if (
    !doc ||
    doc.organizationId !== organizationId ||
    isProjectScopedDocument(doc)
  ) {
    throw new ConvexError({ code: 'NOT_FOUND' });
  }
  if ((doc.lifecycleStatus ?? 'active') !== 'active') return;
  // Legal-hold gate: DELETE / MOVE-overwrite / COPY-overwrite all route a
  // single doc through here. Refuse if the org or the doc's author is held.
  await assertWebdavDocNotHeld(ctx, organizationId, doc);
  await ctx.db.patch(documentId, {
    lifecycleStatus: 'trashed',
    statusChangedAt: Date.now(),
  });
  // Locks at the doc path don't outlive the doc (RFC §7.5). We can't
  // reconstruct the wire path from the doc row alone, but we can drop
  // any lock whose token belongs to a doc-shaped path that resolves
  // here — handled by the MOVE/DELETE callers instead. Caller passes
  // segments where it has them.
}

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
  // Hub-exact: a project folder sharing (org, parent, name) is invisible to
  // WebDAV — treating it as a collision would both leak its existence and
  // block a legitimate hub create (mirrors the project-doc PUT rule).
  const folder = await ctx.db
    .query('folders')
    .withIndex('by_org_project_parent_name', (q) =>
      q
        .eq('organizationId', organizationId)
        .eq('projectId', undefined)
        .eq('parentId', parentFolderId ?? undefined)
        .eq('name', name),
    )
    .first();
  if (folder) return { kind: 'folder', id: folder._id };

  // Exact (org, title, folder) lookup — the composite index bounds the scan
  // to same-name docs in THIS folder rather than every same-name doc in the
  // org (a name repeated across a synced tree would blow the read ceiling).
  // Project-scoped docs don't collide (#2545): they are invisible to WebDAV,
  // so MKCOL/MOVE/COPY must neither be blocked by nor overwrite-trash them.
  const titleMatches = await ctx.db
    .query('documents')
    .withIndex('by_org_title_folder', (q) =>
      q
        .eq('organizationId', organizationId)
        .eq('title', name)
        .eq('folderId', parentFolderId ?? undefined),
    )
    .collect();
  const doc = titleMatches.find((d) => isWebdavVisibleDocument(d));
  if (doc) return { kind: 'document', id: doc._id };
  return null;
}

async function cascadeDeleteFolderRecursive(
  ctx: MutationCtx,
  organizationId: string,
  folderId: Id<'folders'>,
  depth: number = 0,
  budget: ReadBudget = newReadBudget(),
): Promise<void> {
  // Legal-hold pre-walk: assert the ENTIRE subtree is releasable before
  // trashing anything (atomicity — never half-delete a tree). Runs once at the
  // root; the recursion below does the actual trashing. It re-reads the same
  // subtree, so it uses its OWN budget (not this one) to avoid double-charging.
  if (depth === 0) {
    await assertWebdavFolderTreeNotHeld(ctx, organizationId, folderId);
  }
  if (depth > MAX_FOLDER_DEPTH) {
    throw new ConvexError({ code: 'CONFLICT' });
  }
  const children = await ctx.db
    .query('folders')
    .withIndex('by_org_parent_name', (q) =>
      q.eq('organizationId', organizationId).eq('parentId', folderId),
    )
    .take(budgetTake(budget));
  chargeReadBudget(budget, children.length);
  for (const c of children) {
    await cascadeDeleteFolderRecursive(
      ctx,
      organizationId,
      c._id,
      depth + 1,
      budget,
    );
  }
  const docs = await ctx.db
    .query('documents')
    .withIndex('by_organizationId_and_folderId', (q) =>
      q.eq('organizationId', organizationId).eq('folderId', folderId),
    )
    .take(budgetTake(budget));
  chargeReadBudget(budget, docs.length);
  for (const d of docs) {
    // Skip invisible project docs (#2545) — a WebDAV folder delete must
    // never trash a project file, even if one ever gains a folderId.
    if (isWebdavVisibleDocument(d)) {
      await ctx.db.patch(d._id, {
        lifecycleStatus: 'trashed',
        statusChangedAt: Date.now(),
      });
    }
  }
  // Drop any locks rooted under this folder (we delete by org + the
  // canonical wire path is unknown here, so the caller resolves the
  // prefix). When called from DELETE the path-prefix purge runs in the
  // method handler via a separate call; when called from MOVE
  // collision-overwrite the source-side locks are already cleared by
  // moveResource. Folder rows hold no blobs.
  await ctx.db.delete(folderId);
}

async function copyFolderRecursive(
  ctx: MutationCtx,
  organizationId: string,
  srcFolderId: Id<'folders'>,
  destParentId: Id<'folders'> | null,
  destName: string,
  userId: string,
  depth: number,
  budget: ReadBudget = newReadBudget(),
): Promise<Id<'folders'>> {
  if (depth > MAX_FOLDER_DEPTH) {
    throw new ConvexError({ code: 'CONFLICT' });
  }
  const newFolderId = await ctx.db.insert('folders', {
    organizationId,
    name: nfc(destName),
    parentId: destParentId ?? undefined,
    createdBy: userId,
  });

  const childFolders = await ctx.db
    .query('folders')
    .withIndex('by_org_parent_name', (q) =>
      q.eq('organizationId', organizationId).eq('parentId', srcFolderId),
    )
    .take(budgetTake(budget));
  chargeReadBudget(budget, childFolders.length);
  for (const cf of childFolders) {
    await copyFolderRecursive(
      ctx,
      organizationId,
      cf._id,
      newFolderId,
      cf.name,
      userId,
      depth + 1,
      budget,
    );
  }

  const childDocs = await ctx.db
    .query('documents')
    .withIndex('by_organizationId_and_folderId', (q) =>
      q.eq('organizationId', organizationId).eq('folderId', srcFolderId),
    )
    .take(budgetTake(budget));
  chargeReadBudget(budget, childDocs.length);
  for (const d of childDocs) {
    // Invisible project docs (#2545) are never duplicated by a folder COPY.
    if (!isWebdavVisibleDocument(d)) continue;
    await createDocument(ctx, {
      organizationId,
      title: nfc(d.title ?? '(untitled)'),
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

// Walk up `descendantId`'s parent chain. Throws CONFLICT if `ancestorId`
// is encountered — i.e. a MOVE/COPY tries to put a folder inside one
// of its own descendants. Bounded by MAX_FOLDER_DEPTH so corrupt data
// can't spin forever.
async function assertNotDescendantOf(
  ctx: MutationCtx,
  descendantId: Id<'folders'>,
  ancestorId: Id<'folders'>,
): Promise<void> {
  let cursor: Id<'folders'> | undefined = descendantId;
  for (let i = 0; i < MAX_FOLDER_DEPTH; i++) {
    if (!cursor) return;
    if (cursor === ancestorId) {
      throw new ConvexError({ code: 'DEST_IS_DESCENDANT' });
    }
    const row: { parentId?: Id<'folders'> } | null = await ctx.db.get(cursor);
    if (!row) return;
    cursor = row.parentId;
  }
  // Walked past MAX_FOLDER_DEPTH without resolving — treat as corrupt
  // tree and reject conservatively.
  throw new ConvexError({ code: 'CONFLICT' });
}

// Wire path used as the lock key — mirrors lockKeyFromParsed in
// lib/webdav/paths.ts. We assume the segment array is the canonical
// `documents/...` path with NFC normalisation already applied. Trash
// segments are never moved so we always emit the `documents` namespace.
function lockKeyForSegments(segments: string[]): string {
  if (segments.length === 0) return '/documents';
  return '/documents/' + segments.map((s) => encodeURIComponent(s)).join('/');
}

async function purgeLocksAtAndBelow(
  ctx: MutationCtx,
  organizationId: string,
  resourcePath: string,
  alsoDescendants: boolean,
): Promise<void> {
  // Exact-path locks: indexed lookup, O(1) ish.
  const exact = await ctx.db
    .query('webdavLocks')
    .withIndex('by_organization_resource', (q) =>
      q.eq('organizationId', organizationId).eq('resourcePath', resourcePath),
    )
    .collect();
  for (const row of exact) await ctx.db.delete(row._id);

  if (!alsoDescendants) return;

  // Descendant locks: same org, path starts with `${resourcePath}/`.
  // The compound index narrows to the org; we filter to the prefix in
  // memory. Lock tables are small (< few hundred rows per org) so the
  // scan is fine; if this grows we'd add a range scan on resourcePath.
  const prefix = resourcePath.endsWith('/') ? resourcePath : resourcePath + '/';
  const all = await ctx.db
    .query('webdavLocks')
    .withIndex('by_organization_resource', (q) =>
      q.eq('organizationId', organizationId),
    )
    .collect();
  for (const row of all) {
    if (row.resourcePath.startsWith(prefix)) {
      await ctx.db.delete(row._id);
    }
  }
}

// After a folder MOVE/rename, recompute folderPath for every descendant
// document and detach connector-sourced docs (mirrors moveResource's
// document branch). Bounded by MAX_FOLDER_DEPTH. buildFolderPath walks the
// parentId chain to the root; since the moved folder's parentId was already
// repatched before this runs, it yields the NEW absolute path at each level.
async function fixupMovedFolderDescendants(
  ctx: MutationCtx,
  organizationId: string,
  folderId: Id<'folders'>,
  depth: number,
  budget: ReadBudget,
  ragFolderPathUpdates: Array<{
    fileId: BlobRef;
    folderPath?: string;
  }>,
): Promise<void> {
  if (depth > MAX_FOLDER_DEPTH) {
    throw new ConvexError({ code: 'CONFLICT' });
  }
  const folderPath = await buildFolderPath(ctx, folderId);
  const docs = await ctx.db
    .query('documents')
    .withIndex('by_organizationId_and_folderId', (q) =>
      q.eq('organizationId', organizationId).eq('folderId', folderId),
    )
    .take(budgetTake(budget));
  chargeReadBudget(budget, docs.length);
  for (const d of docs) {
    // Project docs are not WebDAV resources (#2545) — leave their rows alone.
    if (!isWebdavVisibleDocument(d)) continue;
    const patch: Record<string, unknown> = { folderPath };
    if (d.sourceProvider && SYNC_SOURCE_PROVIDERS.has(d.sourceProvider)) {
      patch.sourceProvider = undefined;
      patch.externalItemId = undefined;
      patch.driveId = undefined;
    }
    await ctx.db.patch(d._id, patch);
    if (d.fileId) {
      ragFolderPathUpdates.push({ fileId: d.fileId, folderPath });
    }
  }
  const childFolders = await ctx.db
    .query('folders')
    .withIndex('by_org_parent_name', (q) =>
      q.eq('organizationId', organizationId).eq('parentId', folderId),
    )
    .take(budgetTake(budget));
  chargeReadBudget(budget, childFolders.length);
  for (const cf of childFolders) {
    await fixupMovedFolderDescendants(
      ctx,
      organizationId,
      cf._id,
      depth + 1,
      budget,
      ragFolderPathUpdates,
    );
  }
}

async function purgeOldBlob(
  ctx: MutationCtx,
  organizationId: string,
  oldFileId: BlobRef,
): Promise<void> {
  // Refcount guard. COPY shares the source doc's storageId (createDocument is
  // called with fileId: src.fileId — Convex _storage is content-addressed), so
  // one blob can back multiple active documents. Deleting it on a PUT-overwrite
  // would destroy a COPY's bytes out from under it. Skip BOTH the
  // fileMetadata-trash and the storage.delete when any OTHER active document
  // still references this blob. (The doc being overwritten was already
  // repatched to the new storageId before this runs, so it is not in this set.)
  const refs = await ctx.db
    .query('documents')
    .withIndex('by_organizationId_and_fileId', (q) =>
      q.eq('organizationId', organizationId).eq('fileId', oldFileId),
    )
    .collect();
  if (refs.some((d) => (d.lifecycleStatus ?? 'active') === 'active')) {
    return;
  }
  // Mark the corresponding fileMetadata row trashed so retention
  // sweeps don't try to re-index it; then delete the blob. Order
  // matters — if storage.delete fails we still want the metadata in a
  // sensible state.
  //
  // NOTE: the RAG vector entries for the replaced blob are NOT unindexed
  // here — the platform has no remove-from-RAG action on any delete path
  // (uploadFileToRag has no counterpart). This is not a retrieval leak:
  // the document row now points at the NEW storageId, and agent retrieval
  // scope (getAgentScopedFileIds) returns only current, active fileIds, so
  // the orphaned vectors are never surfaced. They are dead weight in the
  // vector store until a system-wide RAG-GC is added (tracked separately).
  const meta = await ctx.db
    .query('fileMetadata')
    .withIndex('by_storageId', (q) => q.eq('storageId', oldFileId))
    .first();
  if (meta && (meta.lifecycleStatus ?? 'active') === 'active') {
    await ctx.db.patch(meta._id, {
      lifecycleStatus: 'trashed',
      statusChangedAt: Date.now(),
      // Detach the stale documentId link. The overwrite already linked a NEW
      // fileMetadata row to this documentId; getByDocumentId does an unfiltered
      // .first() on by_organizationId_and_documentId, so leaving the old
      // (trashed) row linked lets it shadow the active row.
      documentId: undefined,
    });
  }
  const convexId = convexStorageId(oldFileId);
  if (convexId !== null) {
    try {
      await ctx.storage.delete(convexId);
    } catch (err) {
      console.warn('[webdav] purgeOldBlob storage.delete failed', err);
    }
  } else {
    // S3-backed old blob: a mutation can't sign an S3 delete, so schedule the
    // org-scoped node action (best-effort, idempotent).
    await ctx.scheduler.runAfter(
      0,
      internal.files.blob_actions.deleteOrgBlobs,
      { organizationId, refs: [String(oldFileId)] },
    );
  }
}
