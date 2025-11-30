/**
 * Get document by ID (for public API)
 */

import type { QueryCtx } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';
import type { DocumentItemResponse } from './types';
import { getDocumentById } from './get_document_by_id';
import { transformToDocumentItem } from './transform_to_document_item';

export async function getDocumentByIdPublic(
  ctx: QueryCtx,
  documentId: Id<'documents'>,
): Promise<
  | { success: true; item: DocumentItemResponse }
  | { success: false; error: string }
> {
  try {
    const document = await getDocumentById(ctx, documentId);
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
    console.error('Error getting document by ID:', error);
    return {
      success: false,
      error: 'Failed to retrieve document',
    };
  }
}
