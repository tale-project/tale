import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

// The real scheduler (retired)
// routed Document Hub uploads through the same per-org/global concurrency cap
// as chat uploads (`file_metadata/rag_dispatch.ts`, itself now a no-op) before
// dispatching `uploadDocumentToRag`. RAG indexing is offline, so this never
// has anything to schedule — always returns `false` ("no job was scheduled"),
// which is the accurate answer and matches the exported return contract both
// call sites (`documents/internal_mutations.ts`'s `scheduleHubDocumentRagIndexing`
// mutation, `file_metadata/internal_mutations.ts`'s fire-and-forget call) rely on.

/**
 * No-op. See file header.
 */
export async function scheduleHubDocumentRagIndexing(
  _ctx: MutationCtx,
  args: { documentId: Id<'documents'> },
): Promise<boolean> {
  console.debug(
    `[schedule_hub_document_rag_indexing] RAG indexing is offline while the platform AI backend is rewritten; not scheduling for document ${args.documentId}`,
  );
  return false;
}
