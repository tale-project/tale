/**
 * Schedule deletes for a set of synced documents, the way the drive-reconcile
 * path does: a blob-bearing doc goes through the RAG-purging delete (so its
 * vector index is dropped too), a metadata-only doc deletes directly. Deletes
 * are staggered 100ms apart to spare the scheduler + RAG service, and each
 * carries a snapshot guard (expectedExternalItemId/expectedFileId) so it aborts
 * if an interleaving re-upload re-bound the row.
 *
 * Shared by the folder reconcile (files that left the folder) and the
 * single-file reconcile (duplicate rows collapsed to one) so there is one
 * prune path, not a divergent second copy.
 */

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';
import { toId } from '../lib/type_cast_helpers';
import type { SyncedDocumentRef } from './reconcile_folder_sync';

export async function scheduleSyncedDocumentDeletes(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    refs: SyncedDocumentRef[];
    /** Reap now-empty ancestor folders up to (but not including) this id. */
    cleanupAncestorsUpTo?: Id<'folders'>;
  },
): Promise<void> {
  for (let i = 0; i < args.refs.length; i++) {
    const ref = args.refs[i];
    if (ref.fileId) {
      await ctx.scheduler.runAfter(
        i * 100,
        internal.documents.internal_actions.deleteDocumentFromRag,
        {
          documentId: toId<'documents'>(ref.documentId),
          expectedExternalItemId: ref.externalItemId,
          expectedFileId: toId<'_storage'>(ref.fileId),
          cleanupAncestorsUpTo: args.cleanupAncestorsUpTo,
        },
      );
    } else {
      await ctx.scheduler.runAfter(
        i * 100,
        internal.documents.internal_mutations.deleteDocumentById,
        {
          documentId: toId<'documents'>(ref.documentId),
          callerOrgId: args.organizationId,
          cleanupAncestorsUpTo: args.cleanupAncestorsUpTo,
        },
      );
    }
  }
}
