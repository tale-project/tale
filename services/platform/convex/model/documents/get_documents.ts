/**
 * Get documents with pagination and filtering (for public API)
 */

import type { QueryCtx } from '../../_generated/server';
import type { DocumentListResponse } from './types';
import { transformToDocumentItem } from './transform_to_document_item';

export async function getDocuments(
  ctx: QueryCtx,
  args: {
    organizationId: string;
    page?: number;
    size?: number;
    query?: string;
    folderPath?: string;
  },
): Promise<DocumentListResponse> {
  const page = args.page ?? 1;
  const size = args.size ?? 10;
  const searchQuery = args.query?.trim() ?? '';
  const folderPath = args.folderPath ?? '';

  try {
    // Get documents for the organization
    let documentsQuery = ctx.db
      .query('documents')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      );

    // Apply folder path filter if provided
    if (folderPath) {
      documentsQuery = documentsQuery.filter((q) =>
        q.eq(q.field('metadata.storagePath'), folderPath),
      );
    }

    // Apply search filter if provided
    if (searchQuery) {
      documentsQuery = documentsQuery.filter((q) =>
        q.or(
          q.eq(q.field('title'), searchQuery),
          q.eq(q.field('metadata.name'), searchQuery),
        ),
      );
    }

    // Get all documents for counting
    const allDocuments = await documentsQuery.collect();
    const totalItems = allDocuments.length;

    // Apply pagination
    const paginatedDocuments = allDocuments
      .sort((a, b) => (b._creationTime ?? 0) - (a._creationTime ?? 0))
      .slice((page - 1) * size, page * size);

    // Transform documents to DocumentItem format
    const items = await Promise.all(
      paginatedDocuments.map((doc) => transformToDocumentItem(ctx, doc)),
    );

    const hasNextPage = page * size < totalItems;

    return {
      success: true,
      items,
      totalItems,
      pagination: {
        hasNextPage,
        currentPage: page,
        pageSize: size,
      },
    };
  } catch (error) {
    console.error('Error getting documents:', error);
    return {
      success: false,
      items: [],
      totalItems: 0,
      error: 'Failed to retrieve documents',
    };
  }
}
