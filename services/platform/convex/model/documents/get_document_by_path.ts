/**
 * Get document by storage path (for public API)
 */

import type { QueryCtx } from '../../_generated/server';
import type { DocumentItemResponse } from './types';
import { transformToDocumentItem } from './transform_to_document_item';

export async function getDocumentByPath(
  ctx: QueryCtx,
  args: {
    organizationId: string;
    storagePath: string;
  },
): Promise<
  | { success: true; item: DocumentItemResponse }
  | { success: false; error: string }
> {
  try {
    // Find document by storage path in metadata
    const documents = await ctx.db
      .query('documents')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .filter((q) => q.eq(q.field('metadata.storagePath'), args.storagePath))
      .collect();

    const document = documents[0];
    if (!document) {
      return {
        success: false,
        error: 'Document not found',
      };
    }

    const item = await transformToDocumentItem(ctx, document);

    return {
      success: true,
      item,
    };
  } catch (error) {
    console.error('Error getting document by path:', error);
    return {
      success: false,
      error: 'Failed to retrieve document',
    };
  }
}
