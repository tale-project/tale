/**
 * List documents by file extension
 *
 * Uses the by_organizationId_and_extension index to efficiently query
 * documents of a specific type (e.g., 'pptx', 'pdf', 'docx').
 */

import type { QueryCtx } from '../_generated/server';
import type {
  ListDocumentsByExtensionArgs,
  ListDocumentsByExtensionResult,
} from './types';

export async function listDocumentsByExtension(
  ctx: QueryCtx,
  args: ListDocumentsByExtensionArgs,
): Promise<ListDocumentsByExtensionResult> {
  const limit = args.limit ?? 50;

  const documents = await ctx.db
    .query('documents')
    .withIndex('by_organizationId_and_extension', (q) =>
      q
        .eq('organizationId', args.organizationId)
        .eq('extension', args.extension),
    )
    .order('desc')
    .take(limit);

  return documents.map((doc) => ({
    _id: doc._id,
    _creationTime: doc._creationTime,
    title: doc.title,
    fileId: doc.fileId,
    mimeType: doc.mimeType,
    extension: doc.extension,
    metadata: doc.metadata,
  }));
}

