import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

// The real projection (retired)
// joined `fileMetadata.ragStatus` (canonical) for a document's blob. RAG
// indexing is offline (nothing is ever dispatched — see
// `file_metadata/rag_dispatch.ts` and `file_metadata/internal_actions.ts`)
// and RAG search itself is gone with the rest of the knowledge-base rewrite,
// so even a document whose `fileMetadata` row was left `'completed'` from
// before the rewrite is not usefully "indexed" any more — nothing can search
// it. Every document therefore projects as `{ indexed: false }`, which
// `transform_to_document_item.ts` renders as `not_indexed` and
// `projects/queries.ts` counts as zero indexed files.

export interface DocumentRagProjection {
  status?: 'queued' | 'running' | 'completed' | 'failed' | 'unsupported';
  indexedAt?: number;
  error?: string;
  indexed: boolean;
}

const NOT_INDEXED: DocumentRagProjection = { indexed: false };

/**
 * No-op — always `{ indexed: false }`. See file header.
 */
export async function getDocumentRagProjection(
  _ctx: QueryCtx,
  _doc: Pick<Doc<'documents'>, 'fileId'>,
): Promise<DocumentRagProjection> {
  return NOT_INDEXED;
}

/**
 * No-op batch counterpart — every document projects as
 * `{ indexed: false }`. See file header.
 */
export async function getDocumentRagProjectionBatch(
  _ctx: QueryCtx,
  docs: Array<Pick<Doc<'documents'>, '_id' | 'fileId'>>,
): Promise<Map<string, DocumentRagProjection>> {
  const result = new Map<string, DocumentRagProjection>();
  for (const d of docs) {
    result.set(String(d._id), NOT_INDEXED);
  }
  return result;
}
