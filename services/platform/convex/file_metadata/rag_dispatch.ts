import type { GenericMutationCtx } from 'convex/server';

import type { DataModel } from '../_generated/dataModel';
import type { BlobRef } from '../lib/storage/blob_ref';

type MutationCtx = GenericMutationCtx<DataModel>;

// The real dispatcher (retired)
// enforced per-org + global concurrency caps and scheduled `uploadFileToRag` /
// `uploadDocumentToRag` actions against the knowledge-db pool. RAG indexing
// (`convex/rag/`, `convex/knowledge/`) was retired with the rest of the
// knowledge-base rewrite, so there is nothing to dispatch to. Both functions
// are no-ops so file/document upload mutations keep working; uploaded files
// simply stay un-indexed (no RAG search results) until the rewrite lands.

/**
 * No-op. See file header.
 */
export async function maybeDispatchRagIndexing(
  _ctx: MutationCtx,
  storageId: BlobRef,
): Promise<void> {
  console.debug(
    '[file_metadata/rag_dispatch] maybeDispatchRagIndexing is offline while the platform AI backend is rewritten; skipping RAG indexing for',
    storageId,
  );
}

/**
 * No-op. See file header.
 */
export async function promoteQueuedRagJobs(_ctx: MutationCtx): Promise<void> {
  console.debug(
    '[file_metadata/rag_dispatch] promoteQueuedRagJobs is offline while the platform AI backend is rewritten; no parked jobs to promote',
  );
}
