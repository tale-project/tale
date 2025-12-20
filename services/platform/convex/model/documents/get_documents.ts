/**
 * Get documents with pagination and filtering (for public API)
 *
 * Optimized to use async iteration with pre-filtering before expensive transformation.
 * Filters are applied during iteration instead of using .filter() which still scans all records.
 */

import type { QueryCtx } from '../../_generated/server';
import type { Doc } from '../../_generated/dataModel';
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
  const searchQuery = args.query?.trim().toLowerCase() ?? '';
  const folderPath = args.folderPath ?? '';

  try {
    // Get documents for the organization using descending order for newest first
    const baseQuery = ctx.db
      .query('documents')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .order('desc');

    // Use async iteration with filtering
    const matchingDocuments: Array<Doc<'documents'>> = [];

    for await (const doc of baseQuery) {
      // Apply folder path filter
      if (folderPath) {
        const docPath = (doc.metadata as { storagePath?: string })?.storagePath;
        if (docPath !== folderPath) {
          continue;
        }
      }

      // Apply search filter (case-insensitive contains)
      if (searchQuery) {
        const titleMatch = doc.title?.toLowerCase().includes(searchQuery);
        const nameMatch = (doc.metadata as { name?: string })?.name
          ?.toLowerCase()
          .includes(searchQuery);

        if (!titleMatch && !nameMatch) {
          continue;
        }
      }

      matchingDocuments.push(doc);
    }

    const totalItems = matchingDocuments.length;

    // Apply pagination (documents are already sorted by _creationTime desc)
    const startIndex = (page - 1) * size;
    const paginatedDocuments = matchingDocuments.slice(
      startIndex,
      startIndex + size,
    );

    // Transform documents to DocumentItem format (expensive operation - only on paginated subset)
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
