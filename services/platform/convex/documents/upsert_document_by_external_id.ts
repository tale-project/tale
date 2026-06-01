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

import { ConvexError } from 'convex/values';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { buildFolderPath } from '../folders/queries';
import { toConvexJsonRecord } from '../lib/type_cast_helpers';
import { extractExtension } from './extract_extension';
import { findDocumentByExternalId } from './find_document_by_external_id';

export interface UpsertDocumentByExternalIdArgs {
  organizationId: string;
  externalItemId: string;
  /** Optional prefix scope: docs whose folderPath equals or sits under this. */
  folderPathPrefix?: string;
  title: string;
  fileId?: Id<'_storage'>;
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
  /** Integration identifier stamped on the row so reconcile can scope
   * orphan detection per-integration (see `listOrphanedExternalDocs`). */
  driveId?: string;
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

  // Prefix-containment guard. A target folder outside the sync subtree would
  // make the row unfindable on the next sync (prefix mismatch) and produce a
  // duplicate. Refuse the write rather than silently desync.
  if (
    args.folderPathPrefix !== undefined &&
    args.folderPathPrefix.length > 0 &&
    newFolderPath !== undefined &&
    !isPathUnderPrefix(newFolderPath, args.folderPathPrefix)
  ) {
    throw new ConvexError({
      code: 'PREFIX_VIOLATION',
      message: `Target folderPath "${newFolderPath}" is outside the sync prefix "${args.folderPathPrefix}".`,
    });
  }

  if (existing) {
    const contentChanged =
      args.contentHash !== undefined &&
      existing.contentHash !== args.contentHash;
    const folderChanged =
      args.folderId !== undefined && existing.folderId !== args.folderId;
    // Any metadata arg counts as a change. A deep compare is not worth the
    // cost — the patch below is cheap and idempotent.
    const metadataChanged = args.metadata !== undefined;

    if (!contentChanged && !folderChanged && !metadataChanged) {
      return {
        documentId: existing._id,
        action: 'skipped',
        contentChanged: false,
      };
    }

    const patch: Record<string, unknown> = {
      title: args.title,
      mimeType: args.mimeType,
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
    if (Object.keys(cleaned).length > 0) {
      await ctx.db.patch(existing._id, cleaned);
    }

    // When a previously RAG-indexed row gets a new storage handle, the
    // old RAG entry stays orphaned unless we schedule its purge. The
    // C4-retry path (RAG indexed, finalize_content_hash threw, next sync
    // re-uploads) is the main producer of this state. `reindexDocumentInRag`
    // dedup-skips a re-upload when the new content already exists in RAG,
    // so the only work it does here is the old-fileId DELETE.
    if (
      contentChanged &&
      existing.fileId &&
      args.fileId &&
      existing.fileId !== args.fileId &&
      existing.ragInfo?.status === 'completed'
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
  });

  return { documentId, action: 'created', contentChanged: true };
}
