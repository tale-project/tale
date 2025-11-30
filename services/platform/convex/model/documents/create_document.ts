/**
 * Create a new document
 */

import type { MutationCtx } from '../../_generated/server';
import type { CreateDocumentArgs, CreateDocumentResult } from './types';

export async function createDocument(
  ctx: MutationCtx,
  args: CreateDocumentArgs,
): Promise<CreateDocumentResult> {
  const documentId = await ctx.db.insert('documents', {
    organizationId: args.organizationId,
    title: args.title,

    content: args.content,
    fileId: args.fileId,
    metadata: args.metadata,
    sourceProvider: args.sourceProvider,
    externalItemId: args.externalItemId,
  });

  return {
    success: true,
    documentId,
  };
}
