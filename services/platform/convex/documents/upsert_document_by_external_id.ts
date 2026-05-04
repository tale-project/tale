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
 */

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
  sourceProvider?: string;
  contentHash?: string;
  metadata?: Record<string, unknown>;
  folderId?: Id<'folders'>;
  createdBy?: string;
}

export interface UpsertDocumentByExternalIdResult {
  documentId: Id<'documents'>;
  action: 'created' | 'updated' | 'skipped';
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

  if (existing) {
    if (
      args.contentHash !== undefined &&
      existing.contentHash === args.contentHash
    ) {
      return { documentId: existing._id, action: 'skipped' };
    }

    const folderPath = args.folderId
      ? await buildFolderPath(ctx, args.folderId)
      : undefined;

    const patch: Record<string, unknown> = {
      title: args.title,
      fileId: args.fileId,
      mimeType: args.mimeType,
      sourceProvider: args.sourceProvider,
      externalItemId: args.externalItemId,
      contentHash: args.contentHash,
      metadata:
        args.metadata !== undefined
          ? toConvexJsonRecord(args.metadata)
          : undefined,
      folderId: args.folderId,
      folderPath,
    };
    const cleaned = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    );
    if (Object.keys(cleaned).length > 0) {
      await ctx.db.patch(existing._id, cleaned);
    }
    return { documentId: existing._id, action: 'updated' };
  }

  const folderPath = args.folderId
    ? await buildFolderPath(ctx, args.folderId)
    : undefined;

  const documentId = await ctx.db.insert('documents', {
    organizationId: args.organizationId,
    title: args.title,
    fileId: args.fileId,
    mimeType: args.mimeType,
    extension: extractExtension(args.title),
    sourceProvider: args.sourceProvider,
    externalItemId: args.externalItemId,
    contentHash: args.contentHash,
    metadata: toConvexJsonRecord(args.metadata),
    createdBy: args.createdBy,
    folderId: args.folderId,
    folderPath,
  });

  return { documentId, action: 'created' };
}
