/**
 * Update document RAG info (internal helper).
 *
 * @deprecated RAG status is canonical on `fileMetadata.ragStatus`. This writes
 * the retired `documents.ragInfo`/`indexed` fields and is only reachable from
 * the deprecated `checkRagDocumentStatus` poller (kept for pre-cutover drain).
 * New code writes status via `internal.file_metadata.internal_mutations.updateFileRagStatus`.
 */

import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import type { RagInfo } from './types';

export type UpdateDocumentRagInfoArgs = {
  documentId: Id<'documents'>;
  ragInfo: RagInfo;
};

export async function updateDocumentRagInfo(
  ctx: MutationCtx,
  args: UpdateDocumentRagInfoArgs,
): Promise<void> {
  const document = await ctx.db.get(args.documentId);
  if (!document) {
    throw new Error('Document not found');
  }

  await ctx.db.patch(args.documentId, {
    ragInfo: args.ragInfo,
    indexed: args.ragInfo.status === 'completed',
  });
}
