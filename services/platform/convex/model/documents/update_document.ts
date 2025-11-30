/**
 * Update a document (for public API)
 */

import type { MutationCtx } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';
import _ from 'lodash';

export async function updateDocument(
  ctx: MutationCtx,
  args: {
    documentId: Id<'documents'>;
    title?: string;
    content?: string;
    metadata?: unknown;
    fileId?: Id<'_storage'>;
    sourceProvider?: 'onedrive' | 'upload';
    externalItemId?: string;
  },
): Promise<void> {
  const document = await ctx.db.get(args.documentId);
  if (!document) {
    throw new Error('Document not found');
  }

  const updateData: {
    title?: string;
    content?: string;
    metadata?: unknown;
    fileId?: Id<'_storage'>;
    sourceProvider?: 'onedrive' | 'upload';
    externalItemId?: string;
  } = {};
  if (args.title !== undefined) updateData.title = args.title;
  if (args.content !== undefined) updateData.content = args.content;
  if (args.fileId !== undefined) updateData.fileId = args.fileId;
  if (args.sourceProvider !== undefined)
    updateData.sourceProvider = args.sourceProvider;
  if (args.externalItemId !== undefined)
    updateData.externalItemId = args.externalItemId;

  if (args.metadata !== undefined) {
    const existingMetadata = (document as { metadata?: unknown }).metadata;
    if (
      existingMetadata &&
      typeof existingMetadata === 'object' &&
      !Array.isArray(existingMetadata) &&
      args.metadata &&
      typeof args.metadata === 'object' &&
      !Array.isArray(args.metadata)
    ) {
      updateData.metadata = _.merge(
        {},
        existingMetadata as Record<string, unknown>,
        args.metadata as Record<string, unknown>,
      );
    } else {
      updateData.metadata = args.metadata;
    }
  }

  await ctx.db.patch(args.documentId, updateData);
}
