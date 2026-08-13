import {
  knowledgeScopeAllows,
  type KnowledgeAccessScope,
} from '../../lib/knowledge/types';
import type { QueryCtx } from '../_generated/server';
import type { BlobRef } from '../lib/storage/blob_ref';
import { isActiveDocument } from './_helpers';

export interface FilterRetrievableRagFileIdsArgs {
  readonly organizationId: string;
  readonly fileIds: readonly BlobRef[];
  readonly access?: KnowledgeAccessScope;
  readonly folder?: string;
}

/**
 * Validate corpus refs against live Convex truth.
 *
 * SQL scope/status columns are projections and may lag a replacement or scope
 * change. A document hit is returnable only while its metadata is completed,
 * its linked document is active and still points at that exact blob, and its
 * current scope/folder still matches the request.
 *
 * A thread-bound chat upload (`threadId` set, no `documentId`) is its own
 * access class — the 0.3 model (`verify_thread_scoped_access`): retrievable
 * ONLY when the caller's access lists that thread. It is private to its
 * thread, so an org-wide caller (absent access) does NOT see it.
 */
export async function filterRetrievableRagFileIds(
  ctx: QueryCtx,
  args: FilterRetrievableRagFileIdsArgs,
): Promise<string[]> {
  const retrievable: string[] = [];
  const seen = new Set<string>();
  const allowedThreadIds = new Set(args.access?.threadIds ?? []);

  for (const fileId of args.fileIds) {
    const ref = String(fileId);
    if (seen.has(ref)) continue;
    seen.add(ref);

    const metadata = await ctx.db
      .query('fileMetadata')
      .withIndex('by_storageId', (q) => q.eq('storageId', fileId))
      .first();
    if (
      metadata === null ||
      metadata.organizationId !== args.organizationId ||
      metadata.ragStatus !== 'completed' ||
      metadata.lifecycleStatus === 'trashed'
    ) {
      continue;
    }

    if (metadata.threadId !== undefined) {
      // Chat upload bound to a thread: the folder filter is a Document Hub
      // concept, so a folder-scoped search never returns thread uploads.
      if (
        allowedThreadIds.has(metadata.threadId) &&
        (args.folder === undefined || args.folder === '')
      ) {
        retrievable.push(ref);
      }
      continue;
    }

    if (metadata.documentId === undefined) {
      continue;
    }

    const document = await ctx.db.get(metadata.documentId);
    if (
      document === null ||
      document.organizationId !== args.organizationId ||
      !isActiveDocument(document) ||
      (document.fileId ?? '') !== ref
    ) {
      continue;
    }

    if (
      args.folder !== undefined &&
      args.folder !== '' &&
      document.folderPath !== args.folder &&
      !document.folderPath?.startsWith(`${args.folder}/`)
    ) {
      continue;
    }

    if (
      !knowledgeScopeAllows(args.access, {
        teamIds: document.teamTags ?? null,
        teamId: document.teamId ?? null,
        projectId: document.projectId ?? null,
      })
    ) {
      continue;
    }

    retrievable.push(ref);
  }

  return retrievable;
}
