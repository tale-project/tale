/**
 * Atomic upsert keyed by `(organizationId, externalItemId)` — and optionally
 * scoped to a sync subtree via `folderPathPrefix`.
 *
 * Convex has no unique-index constraint, but a single mutation runs in one
 * transaction with optimistic concurrency control: two parallel calls that
 * both observe "no existing doc" and both insert will conflict on the index
 * read+write set, and Convex retries the loser. On retry the loser sees the
 * row inserted by the winner and takes the update branch — so concurrent
 * sync runs converge on a single document row instead of duplicating.
 *
 * `contentHash` is intentionally NOT written here — callers (sync workflows)
 * finalize it in a separate `update` step after RAG indexing succeeds. If
 * RAG fails, the stale/missing hash forces `check_unchanged` false on the
 * next run, automatically retrying the download + index. Without this
 * deferral, a failed first-time RAG upload writes the new hash on the row
 * and `check_unchanged` would skip the retry forever.
 */

import { AppError } from '../../lib/shared/errors/app-error';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { buildFolderPath } from '../folders/queries';
import { convexStorageId, type BlobRef } from '../lib/storage/blob_ref';
import { toConvexJsonRecord } from '../lib/type_cast_helpers';
import {
  assertGenericDocumentContentWritable,
  isRecordContentFrozen,
} from './access';
import { extractExtension } from './extract_extension';
import { findDocumentByExternalId } from './find_document_by_external_id';

export interface UpsertDocumentByExternalIdArgs {
  organizationId: string;
  externalItemId: string;
  /** Optional prefix scope: docs whose folderPath equals or sits under this. */
  folderPathPrefix?: string;
  title: string;
  fileId?: BlobRef;
  mimeType?: string;
  /** File extension for the document row. Sync titles are kept clean (no
   * extension), so callers derive this from the stored blob's filename and
   * pass it explicitly; falls back to the title's extension when omitted. */
  extension?: string;
  sourceProvider?: string;
  contentHash?: string;
  metadata?: Record<string, unknown>;
  folderId?: Id<'folders'>;
  createdBy?: string;
  /** Connector identifier stamped on the row so reconcile can scope
   * orphan detection per-connector (see `listOrphanedExternalDocs`). */
  driveId?: string;
  /** Direct project scope for a folderless write (an agent's `document_create`
   * in a project-bound run). A `folderId` still wins — project scope follows
   * the folder there — so this only applies when no folder is given. */
  projectId?: Id<'projects'>;
}

export interface UpsertDocumentByExternalIdResult {
  documentId: Id<'documents'>;
  action: 'created' | 'updated' | 'skipped';
  /**
   * True when this call wrote a new file version (fresh insert, or update
   * with differing `contentHash`). False for pure metadata / folder moves
   * and for skips. Sync workflows key RAG re-indexing on this flag so a
   * location-only move does not re-emit the unchanged file to RAG.
   */
  contentChanged: boolean;
}

function isPathUnderPrefix(path: string, prefix: string): boolean {
  // Normalize trailing slash on the prefix so user inputs like
  // "Google Drive/" don't false-reject every write.
  const p = prefix.replace(/\/+$/, '');
  if (p.length === 0) return true;
  return path === p || path.startsWith(p + '/');
}

export async function upsertDocumentByExternalId(
  ctx: MutationCtx,
  args: UpsertDocumentByExternalIdArgs,
): Promise<UpsertDocumentByExternalIdResult> {
  const existing = await findDocumentByExternalId(ctx, {
    organizationId: args.organizationId,
    externalItemId: args.externalItemId,
    folderPathPrefix: args.folderPathPrefix,
  });

  const newFolderPath = args.folderId
    ? await buildFolderPath(ctx, args.folderId)
    : undefined;

  // A document inside a project folder must carry that folder's projectId —
  // the project Files tree lists by it (listProjectDocuments), and
  // createDocument enforces the same scope rule for non-sync writers. Derive
  // it from the target folder instead of trusting callers to thread it
  // through (the workflow document path never did, leaving filed outputs
  // invisible in Project Files).
  const targetFolder = args.folderId ? await ctx.db.get(args.folderId) : null;
  const targetProjectId = targetFolder?.projectId;
  // The project the row belongs to: the folder's when filed into one, else the
  // caller's direct scope (a folderless agent write). `undefined` is the hub.
  const scopeProjectId = args.folderId ? targetProjectId : args.projectId;

  // Prefix-containment guard. A target folder outside the sync subtree would
  // make the row unfindable on the next sync (prefix mismatch) and produce a
  // duplicate. Refuse the write rather than silently desync.
  if (
    args.folderPathPrefix !== undefined &&
    args.folderPathPrefix.length > 0 &&
    newFolderPath !== undefined &&
    !isPathUnderPrefix(newFolderPath, args.folderPathPrefix)
  ) {
    throw new AppError({
      code: 'PREFIX_VIOLATION',
      message: `Target folderPath "${newFolderPath}" is outside the sync prefix "${args.folderPathPrefix}".`,
    });
  }

  if (existing) {
    let contentChanged =
      args.contentHash !== undefined &&
      existing.contentHash !== args.contentHash;
    // A hash-less caller (the workflow document `create` path) hands over a
    // freshly stored blob and no provider hash. "No hash" must not read as
    // "unchanged" — compare the blobs' own storage sha256 instead, else the
    // new content is silently dropped and the row keeps serving the old file.
    if (
      args.contentHash === undefined &&
      args.fileId !== undefined &&
      args.fileId !== existing.fileId
    ) {
      if (existing.fileId === undefined) {
        contentChanged = true;
      } else {
        // `db.system.get` only sizes/hashes Convex `_storage` blobs. When either
        // side is an `s3:` ref its bytes live in the org's bucket (no system
        // row to hash), so we can't SHA-compare — treat as changed so a real
        // update re-indexes rather than being skipped.
        const oldConvex = convexStorageId(existing.fileId);
        const newConvex = convexStorageId(args.fileId);
        if (oldConvex === null || newConvex === null) {
          contentChanged = true;
        } else {
          const [oldBlob, newBlob] = await Promise.all([
            ctx.db.system.get(oldConvex),
            ctx.db.system.get(newConvex),
          ]);
          contentChanged =
            oldBlob === null ||
            newBlob === null ||
            oldBlob.sha256 !== newBlob.sha256;
        }
      }
    }
    const folderChanged =
      args.folderId !== undefined && existing.folderId !== args.folderId;
    // Project scope follows the folder — a mismatch (including a row healed
    // from the pre-projectId era) is a location change even when the folder
    // id itself is unchanged. A folderless write compares the direct scope
    // instead, so a re-run that names a different project re-scopes the row.
    const projectChanged =
      args.folderId !== undefined
        ? existing.projectId !== targetProjectId
        : args.projectId !== undefined && existing.projectId !== args.projectId;
    // Any metadata arg counts as a change. A deep compare is not worth the
    // cost — the patch below is cheap and idempotent.
    const metadataChanged = args.metadata !== undefined;

    if (
      !contentChanged &&
      !folderChanged &&
      !projectChanged &&
      !metadataChanged
    ) {
      return {
        documentId: existing._id,
        action: 'skipped',
        contentChanged: false,
      };
    }

    // Controlled-record content has one attested replacement door. Agent rows
    // created through `document.create` can be controlled, so a producing
    // automation's re-run must not replace even a draft through this upsert.
    // True connector rows cannot normally be controlled; keep the same guard
    // as defense in depth. Location/metadata-only updates remain allowed.
    if (contentChanged) {
      assertGenericDocumentContentWritable(existing);
    }

    const patch: Record<string, unknown> = {
      title: args.title,
      // `mimeType` is a frozen identity field (`isRecordContentFrozen`): a
      // location/metadata-only update on an in_review/approved record must
      // not rewrite it. (contentChanged already threw above when frozen;
      // title/renames stay free in every state by design.)
      ...(isRecordContentFrozen(existing) ? {} : { mimeType: args.mimeType }),
      sourceProvider: args.sourceProvider,
      externalItemId: args.externalItemId,
      driveId: args.driveId,
      metadata:
        args.metadata !== undefined
          ? toConvexJsonRecord(args.metadata)
          : undefined,
      folderId: args.folderId,
      folderPath: newFolderPath,
    };
    // Only patch the storage handle when the underlying content actually
    // changed; otherwise a same-md5 cross-folder move would orphan the old
    // blob for no gain. When we do swap fileId, preserve the previous
    // storage handle in `historyFiles` so `eraseDocumentBlobs` can clean
    // it up on later deletion and so version-history readers can still
    // reach prior revisions.
    if (contentChanged) {
      patch.fileId = args.fileId;
      patch.extension = args.extension ?? extractExtension(args.title);
      if (existing.fileId && existing.fileId !== args.fileId) {
        patch.historyFiles = [
          ...(existing.historyFiles ?? []),
          existing.fileId,
        ];
      }
    }
    const cleaned = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    );
    // After the undefined-strip: an explicit undefined must survive here so a
    // move into a hub folder CLEARS the stale project scope (Convex patch
    // unsets a field set to undefined).
    if (projectChanged) {
      cleaned.projectId = scopeProjectId;
    }
    if (Object.keys(cleaned).length > 0) {
      await ctx.db.patch(existing._id, cleaned);
    }

    // When a previously RAG-indexed row gets a new storage handle, schedule
    // the current generation for indexing. The C4-retry path (RAG indexed,
    // finalize_content_hash threw, next sync re-uploads) is the main producer
    // of this state. Replaced corpus rows are retained until reverse-reference
    // accounting can prove that no sibling document shares the old blob.
    // Re-index gate reads canonical fileMetadata.ragStatus for the existing
    // blob (documents.ragInfo is retired).
    const existingFileId = existing.fileId;
    const existingFm = existingFileId
      ? await ctx.db
          .query('fileMetadata')
          .withIndex('by_storageId', (q) => q.eq('storageId', existingFileId))
          .first()
      : null;
    const existingIndexed = existingFm?.ragStatus === 'completed';

    if (
      contentChanged &&
      existing.fileId &&
      args.fileId &&
      existing.fileId !== args.fileId &&
      existingIndexed
    ) {
      await ctx.scheduler.runAfter(
        0,
        internal.documents.internal_actions.reindexDocumentInRag,
        {
          documentId: existing._id,
          oldFileId: existing.fileId,
          oldOrganizationId: existing.organizationId,
        },
      );
    }

    // A folder move across the project boundary is a SCOPE change even when
    // the bytes are identical: the corpus row's project_id must follow or
    // retrieval keeps serving the file under its old visibility. Scope-only
    // sync — the action re-reads the row, so it stamps the patched truth
    // (idempotent beside a content-change reindex, which stamps it too).
    if (projectChanged) {
      await ctx.scheduler.runAfter(
        0,
        internal.documents.internal_actions.syncRagDocumentScopes,
        {
          organizationId: existing.organizationId,
          documentIds: [existing._id],
        },
      );
    }

    return {
      documentId: existing._id,
      action: 'updated',
      contentChanged,
    };
  }

  const documentId = await ctx.db.insert('documents', {
    organizationId: args.organizationId,
    title: args.title,
    fileId: args.fileId,
    mimeType: args.mimeType,
    extension: args.extension ?? extractExtension(args.title),
    sourceProvider: args.sourceProvider,
    externalItemId: args.externalItemId,
    driveId: args.driveId,
    // contentHash deliberately omitted — see file docstring.
    metadata: toConvexJsonRecord(args.metadata),
    createdBy: args.createdBy,
    folderId: args.folderId,
    folderPath: newFolderPath,
    projectId: scopeProjectId,
  });

  return { documentId, action: 'created', contentChanged: true };
}
