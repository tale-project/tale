/**
 * Create a new document
 */

import type { MutationCtx } from '../../_generated/server';
import type { CreateDocumentArgs, CreateDocumentResult } from './types';
import { extractExtension } from './extract_extension';

export async function createDocument(
  ctx: MutationCtx,
  args: CreateDocumentArgs,
): Promise<CreateDocumentResult> {
  // Auto-extract extension from title if not provided
  const extension = args.extension ?? extractExtension(args.title);

  const documentId = await ctx.db.insert('documents', {
    organizationId: args.organizationId,
    title: args.title,

    content: args.content,
    fileId: args.fileId,
    mimeType: args.mimeType,
    extension,
    metadata: args.metadata,
    sourceProvider: args.sourceProvider,
    externalItemId: args.externalItemId,
  });

  return {
    success: true,
    documentId,
  };
}
