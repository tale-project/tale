/**
 * Update document RAG info (internal helper)
 */

import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
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
  });
}
