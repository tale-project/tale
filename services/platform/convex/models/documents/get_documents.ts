/**
 * Get documents with pagination and filtering (for public API)
 *
 * Optimized to use async iteration with pre-filtering before expensive transformation.
 * Filters are applied during iteration instead of using .filter() which still scans all records.
 */

import type { QueryCtx } from '../../_generated/server';
import type { Doc } from '../../_generated/dataModel';
import type { DocumentListResponse } from './types';
import { transformDocumentsBatch } from './transform_to_document_item';

export async function getDocuments(
  ctx: QueryCtx,
  args: {
    organizationId: string;
    page?: number;
    size?: number;
    query?: string;
    folderPath?: string;
    sortField?: string;
    sortOrder?: 'asc' | 'desc';
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

    // Apply sorting if specified
    const sortField = args.sortField || '_creationTime';
    const sortOrder = args.sortOrder || 'desc';
    matchingDocuments.sort((a, b) => {
      const aVal = (a as Record<string, unknown>)[sortField];
      const bVal = (b as Record<string, unknown>)[sortField];
      if (aVal === bVal) return 0;
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;
      const comparison = aVal < bVal ? -1 : 1;
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    // Apply pagination
    const startIndex = (page - 1) * size;
    const paginatedDocuments = matchingDocuments.slice(
      startIndex,
      startIndex + size,
    );

    // Transform documents to DocumentItem format using batch processing
    // This efficiently fetches user names and storage URLs in parallel
    const items = await transformDocumentsBatch(ctx, paginatedDocuments);

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
